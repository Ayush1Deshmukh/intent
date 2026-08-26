/**
 * The ingest pipeline, as a pure function over parsed files.
 *
 *   parse -> map headers -> detect column formats -> normalize per row
 *         -> reconcile secondary sources (conflicts are RAISED, never resolved)
 *         -> run the rules engine
 *
 * Kept free of database calls so it can be unit-tested and dry-run from a script.
 */
import { CanonicalField } from "@/lib/schema/fields";
import { detectColumnHints, normalizeRow, NormalizedRow } from "@/lib/coerce";
import { HeaderMatch, matchHeaders, shapeHint, unmappedHeaders } from "./map";
import { ParsedFile } from "./parse";
import { EngineRecord, ExceptionDraft, runRulesDetailed } from "@/lib/rules/engine";
import { RULE_CATALOG, RuleDef } from "@/lib/rules/catalog";
import { rowHash } from "@/lib/hash";

export type SourceKind = "LOAN_TAPE" | "SERVICER_UPDATE" | "DOCUMENT_MANIFEST";

export type Conflict = { primary: string; secondary: string; source: string };

export type PipelineRow = {
  rowNumber: number;
  rowHash: string;
  original: Record<string, string>;
  normalized: NormalizedRow;
  conflicts: Partial<Record<CanonicalField, Conflict>>;
};

export type PipelineResult = {
  matches: HeaderMatch[];
  hints: ReturnType<typeof detectColumnHints>;
  rows: PipelineRow[];
  exceptions: ExceptionDraft[];
  unmapped: string[];
  conflictCount: number;
  /** dependent rules skipped because an input field was already flagged */
  suppressed: number;
};

/** headers that carry no data but should not be flagged as an oversight */
const IGNORABLE = /^(notes?|comments?|remarks?|internal)$/i;

export function proposeMappings(file: ParsedFile): HeaderMatch[] {
  const matches = matchHeaders(file.headers, file.rows);
  // pass 4 fallback: infer from the SHAPE of the values when the name says nothing
  const taken = new Set(matches.map((m) => m.canonicalField).filter(Boolean) as CanonicalField[]);
  for (const m of matches) {
    if (m.canonicalField) continue;
    if (IGNORABLE.test(m.sourceHeader.trim())) {
      m.rationale = "free-text column with no canonical equivalent — leave it unmapped";
      continue;
    }
    const hint = shapeHint(m.samples);
    if (hint && !taken.has(hint.field)) {
      taken.add(hint.field);
      m.canonicalField = hint.field;
      m.method = "AI";
      m.confidence = 0.61;
      m.rationale = hint.why;
    }
  }
  return matches;
}

function mappingMap(matches: HeaderMatch[]): Map<string, CanonicalField> {
  const m = new Map<string, CanonicalField>();
  for (const h of matches) if (h.canonicalField) m.set(h.sourceHeader, h.canonicalField);
  return m;
}

/** derive documentStatus from a manifest row that lists the individual documents */
function manifestStatus(row: Record<string, string>): string {
  const yes = (v: string) => /^(y|yes|true|1|complete|received)$/i.test((v ?? "").trim());
  const flags = Object.entries(row)
    .filter(([k]) => !/loan|id|no\b/i.test(k))
    .map(([, v]) => yes(v));
  if (flags.length === 0) return "UNKNOWN";
  if (flags.every(Boolean)) return "COMPLETE";
  if (flags.some(Boolean)) return "PARTIAL";
  return "MISSING";
}

const MATERIAL_MONEY_DIFF = 0.005; // 0.5%

function isMaterial(field: CanonicalField, a: string, b: string): boolean {
  if (a === b) return false;
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na === nb) return false;
    const scale = Math.max(Math.abs(na), Math.abs(nb), 1);
    if (field === "currentBalance" || field === "originalPrincipal" || field === "paymentAmount") {
      return Math.abs(na - nb) / scale > MATERIAL_MONEY_DIFF;
    }
    return true;
  }
  return String(a).trim().toUpperCase() !== String(b).trim().toUpperCase();
}

export function runPipeline(
  primary: ParsedFile,
  secondaries: { kind: SourceKind; file: ParsedFile }[],
  opts: { asOf: string; servicers: Set<string>; rules?: RuleDef[]; confirmedMappings?: HeaderMatch[] },
): PipelineResult {
  const matches = opts.confirmedMappings ?? proposeMappings(primary);
  const map = mappingMap(matches);
  const hints = detectColumnHints(primary.rows, map);

  const rows: PipelineRow[] = primary.rows.map((original, i) => ({
    rowNumber: i + 2, // +2: one-based, and the header occupies line 1
    rowHash: rowHash(primary.sha256, i + 2, original),
    original,
    normalized: normalizeRow(original, map, hints),
    conflicts: {},
  }));

  const byLoanId = new Map<string, PipelineRow[]>();
  for (const r of rows) {
    const id = r.normalized.values.loanId;
    if (!id) continue;
    const k = String(id);
    if (!byLoanId.has(k)) byLoanId.set(k, []);
    byLoanId.get(k)!.push(r);
  }

  let conflictCount = 0;

  for (const sec of secondaries) {
    if (sec.kind === "DOCUMENT_MANIFEST") {
      const idHeader = sec.file.headers.find((h) => /loan/i.test(h)) ?? sec.file.headers[0];
      for (const row of sec.file.rows) {
        const targets = byLoanId.get(String(row[idHeader] ?? "").trim());
        if (!targets) continue;
        for (const t of targets) t.normalized.values.documentStatus = manifestStatus(row);
      }
      continue;
    }

    // SERVICER_UPDATE — same header matching, then compare field by field
    const secMatches = proposeMappings(sec.file);
    const secMap = mappingMap(secMatches);
    const secHints = detectColumnHints(sec.file.rows, secMap);
    for (const row of sec.file.rows) {
      const norm = normalizeRow(row, secMap, secHints);
      const id = norm.values.loanId;
      if (!id) continue;
      const targets = byLoanId.get(String(id));
      if (!targets) continue;
      for (const t of targets) {
        for (const [field, value] of Object.entries(norm.values) as [CanonicalField, string | number | null][]) {
          if (field === "loanId" || field === "lastUpdatedAt") continue;
          if (value === null || value === undefined || value === "") continue;
          const mine = t.normalized.values[field];
          if (mine === null || mine === undefined || mine === "") continue;
          if (isMaterial(field, String(mine), String(value))) {
            t.conflicts[field] = {
              primary: String(mine),
              secondary: String(value),
              source: sec.file.filename,
            };
            conflictCount++;
          }
        }
      }
    }
  }

  const engineRecords: EngineRecord[] = rows.map((r, i) => ({
    id: String(i),
    loanId: (r.normalized.values.loanId as string) ?? null,
    values: r.normalized.values,
    errors: r.normalized.errors,
    conflicts: r.conflicts,
  }));

  const unmapped = unmappedHeaders(matches).filter((h) => !IGNORABLE.test(h.trim()));

  const { drafts: exceptions, suppressed } = runRulesDetailed(engineRecords, opts.rules ?? RULE_CATALOG, {
    servicers: opts.servicers,
    asOf: opts.asOf,
    unmappedHeaders: unmapped,
  });

  return { matches, hints, rows, exceptions, unmapped, conflictCount, suppressed };
}
