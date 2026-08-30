import { and, eq } from "drizzle-orm";
import {
  db, tapes, sourceFiles, rawRecords, loanRecords, transformations,
  fieldMappings, exceptions, rules,
} from "@/lib/db";
import { emitMany, NewEvent } from "@/lib/audit";
import { recordHash, rowHash } from "@/lib/hash";
import { parseBuffer, ParsedFile } from "@/lib/ingest/parse";
import { proposeMappings, runPipeline, SourceKind } from "@/lib/ingest/pipeline";
import { HeaderMatch } from "@/lib/ingest/map";
import { CANONICAL_FIELDS, CanonicalField, FIELD_META } from "@/lib/schema/fields";
import { RuleDef } from "@/lib/rules/catalog";
import { Session } from "@/lib/auth";
import { HttpProblem } from "@/lib/problem";

export type UploadFile = { kind: SourceKind; filename: string; buffer: Buffer };

const chunk = <T,>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/* ------------------------------------------------------------------------ */
/* Stage 1 — land the files verbatim and PROPOSE a mapping. Nothing canonical */
/* is written until a person confirms it.                                    */
/* ------------------------------------------------------------------------ */

export async function ingestFiles(session: Session, name: string, files: UploadFile[], maxRows: number) {
  const parsed = files.map((f) => ({ kind: f.kind, parsed: parseBuffer(f.filename, f.buffer) }));
  const primaryEntry = parsed.find((p) => p.kind === "LOAN_TAPE");
  if (!primaryEntry) {
    throw new HttpProblem(400, "missing-primary-file",
      "A loan tape is required. Secondary sources describe loans; they cannot establish them.");
  }
  const primaryParsed = primaryEntry.parsed;
  if (primaryParsed.rows.length === 0) {
    throw new HttpProblem(422, "empty-tape", `${primaryParsed.filename} produced no readable rows.`);
  }
  if (primaryParsed.rows.length > maxRows) {
    throw new HttpProblem(413, "tape-too-large",
      `This tape has ${primaryParsed.rows.length} rows; this instance accepts up to ${maxRows}.`);
  }

  return db.transaction(async (tx) => {
    const [tape] = await tx.insert(tapes).values({
      name, status: "MAPPING", rowCount: primaryParsed.rows.length, uploadedById: session.userId,
    }).returning();

    const events: NewEvent[] = [];

    for (const { kind, parsed: p } of parsed) {
      const [sf] = await tx.insert(sourceFiles).values({
        tapeId: tape.id, kind, filename: p.filename, sha256: p.sha256,
        rowCount: p.rows.length, headers: p.headers,
      }).returning();

      const raws = p.rows.map((original, i) => ({
        sourceFileId: sf.id, rowNumber: i + 2, original,
        rowHash: rowHash(p.sha256, i + 2, original),
      }));
      for (const c of chunk(raws, 250)) await tx.insert(rawRecords).values(c);

      events.push({
        tapeId: tape.id, actorId: session.userId, actorRole: session.role,
        action: "FILE_INGESTED", entityType: "sourceFile", entityId: sf.id,
        payload: { kind, filename: p.filename, sha256: p.sha256, rows: p.rows.length, headers: p.headers },
      });
    }

    const matches = proposeMappings(primaryParsed);
    await tx.insert(fieldMappings).values(matches.map((m) => ({
      tapeId: tape.id, sourceKind: "LOAN_TAPE" as const, sourceHeader: m.sourceHeader,
      canonicalField: m.canonicalField, method: m.method, confidence: m.confidence,
      samples: m.samples, rationale: m.rationale ?? null,
    })));

    events.push({
      tapeId: tape.id, actorId: session.userId, actorRole: session.role,
      action: "MAPPING_PROPOSED", entityType: "tape", entityId: tape.id,
      payload: { mappings: matches.map((m) => ({ header: m.sourceHeader, field: m.canonicalField, method: m.method, confidence: m.confidence })) },
    });

    await emitMany(tx, events);
    return { tapeId: tape.id, rowCount: primaryParsed.rows.length, sha256: primaryParsed.sha256, matches };
  });
}

/* ------------------------------------------------------------------------ */
/* Stage 2 — the mapping is confirmed, so normalize, reconcile and validate.  */
/* ------------------------------------------------------------------------ */

async function loadParsed(tapeId: string): Promise<{ kind: SourceKind; file: ParsedFile }[]> {
  const files = await db.select().from(sourceFiles).where(eq(sourceFiles.tapeId, tapeId));
  const out: { kind: SourceKind; file: ParsedFile }[] = [];
  for (const f of files) {
    const raws = await db.select().from(rawRecords).where(eq(rawRecords.sourceFileId, f.id));
    raws.sort((a, b) => a.rowNumber - b.rowNumber);
    out.push({
      kind: f.kind as SourceKind,
      file: { filename: f.filename, sha256: f.sha256, headers: f.headers as string[],
              rows: raws.map((r) => r.original as Record<string, string>), badRows: [] },
    });
  }
  return out;
}

export async function loadRuleDefs(): Promise<RuleDef[]> {
  const rows = await db.select().from(rules).where(eq(rules.enabled, true));
  return rows.map((r) => ({
    code: r.code, name: r.name, description: r.description, category: r.category,
    severity: r.severity as RuleDef["severity"], scope: r.scope as "record" | "tape",
    field: (r.field as CanonicalField | null), expected: r.expected,
    expression: r.expression as RuleDef["expression"],
    repairHint: r.repairHint ?? undefined,
    dependsOn: (r.dependsOn as CanonicalField[] | null) ?? undefined,
  }));
}

export async function normalizeAndValidate(session: Session, tapeId: string, asOf: string) {
  const parsed = await loadParsed(tapeId);
  const primaryEntry = parsed.find((p) => p.kind === "LOAN_TAPE");
  if (!primaryEntry) throw new HttpProblem(404, "tape-not-found", "No loan tape found for this batch.");

  const savedMappings = await db.select().from(fieldMappings)
    .where(and(eq(fieldMappings.tapeId, tapeId), eq(fieldMappings.sourceKind, "LOAN_TAPE")));

  const confirmed: HeaderMatch[] = primaryEntry.file.headers.map((h) => {
    const m = savedMappings.find((s) => s.sourceHeader === h);
    return {
      sourceHeader: h,
      canonicalField: (m?.canonicalField as CanonicalField | null) ?? null,
      method: (m?.method ?? "MANUAL") as HeaderMatch["method"],
      confidence: m?.confidence ?? 0,
      samples: (m?.samples as string[]) ?? [],
      rationale: m?.rationale ?? undefined,
    };
  });

  const ruleDefs = await loadRuleDefs();
  const servicerRows = await db.query.servicerRefs.findMany();
  const servicers = new Set(servicerRows.map((s) => s.id));

  const result = runPipeline(
    primaryEntry.file,
    parsed.filter((p) => p.kind !== "LOAN_TAPE"),
    { asOf, servicers, rules: ruleDefs, confirmedMappings: confirmed },
  );

  // raw row ids, so each canonical record keeps a pointer home
  const primaryFile = (await db.select().from(sourceFiles)
    .where(and(eq(sourceFiles.tapeId, tapeId), eq(sourceFiles.kind, "LOAN_TAPE"))))[0];
  const raws = await db.select({ id: rawRecords.id, rowNumber: rawRecords.rowNumber })
    .from(rawRecords).where(eq(rawRecords.sourceFileId, primaryFile.id));
  const rawIdByRow = new Map(raws.map((r) => [r.rowNumber, r.id]));

  const ruleIdByCode = new Map((await db.select({ id: rules.id, code: rules.code }).from(rules))
    .map((r) => [r.code, r.id]));

  return db.transaction(async (tx) => {
    // re-running validation replaces the working zone; the raw zone is untouched
    await tx.delete(exceptions).where(eq(exceptions.tapeId, tapeId));
    await tx.delete(loanRecords).where(eq(loanRecords.tapeId, tapeId));

    const events: NewEvent[] = [{
      tapeId, actorId: session.userId, actorRole: session.role,
      action: "MAPPING_CONFIRMED", entityType: "tape", entityId: tapeId,
      payload: {
        mappings: confirmed.map((c) => ({ header: c.sourceHeader, field: c.canonicalField, method: c.method })),
        columnFormats: result.hints,
      },
    }];

    const recordIdByIndex = new Map<number, string>();
    const transformRows: (typeof transformations.$inferInsert)[] = [];

    for (const [i, row] of result.rows.entries()) {
      const v = row.normalized.values;
      /**
       * Built from CANONICAL_FIELDS rather than a hand-written list.
       *
       * The previous version enumerated every column by name, and when the schema
       * widened to cover the challenge's full field set, seven of them were simply
       * never written — the columns existed, the coercion produced values, and the
       * insert silently dropped them. Nothing failed; the data was just missing.
       *
       * The hash contract in `businessFields()` stays hand-written for the opposite
       * reason: what a signature covers must not widen by accident. Persistence should
       * store whatever the canonical schema defines. Those are different jobs.
       */
      const draft: Record<string, unknown> = {
        tapeId,
        rawRecordId: rawIdByRow.get(row.rowNumber)!,
        verificationStatus: "PENDING" as const,
        version: 1,
        recordHash: "",
      };
      for (const f of CANONICAL_FIELDS) {
        const value = v[f];
        if (value === undefined || value === null) { draft[f] = null; continue; }
        // timestamps are the one kind the driver wants as a Date; dates, money and
        // rates all stay strings so no float ever touches a monetary column
        draft[f] = FIELD_META[f].kind === "timestamp" ? new Date(String(value)) : value;
      }

      draft.recordHash = recordHash({ ...draft, id: null, version: 1 });
      const [rec] = await tx.insert(loanRecords)
        .values(draft as typeof loanRecords.$inferInsert).returning({ id: loanRecords.id });
      recordIdByIndex.set(i, rec.id);

      for (const t of row.normalized.transformations) {
        transformRows.push({ recordId: rec.id, field: t.field, before: t.before, after: t.after, coercion: t.coercion });
      }
      if (row.normalized.transformations.length) {
        events.push({
          tapeId, actorId: session.userId, actorRole: session.role,
          action: "VALUE_COERCED", entityType: "loanRecord", entityId: rec.id,
          payload: { rowNumber: row.rowNumber, transformations: row.normalized.transformations },
        });
      }
      if (Object.keys(row.conflicts).length) {
        events.push({
          tapeId, actorId: session.userId, actorRole: session.role,
          action: "CONFLICT_DETECTED", entityType: "loanRecord", entityId: rec.id,
          payload: { rowNumber: row.rowNumber, conflicts: row.conflicts },
        });
      }
    }

    for (const c of chunk(transformRows, 250)) await tx.insert(transformations).values(c);

    events.push({
      tapeId, actorId: session.userId, actorRole: session.role,
      action: "RULES_RUN", entityType: "tape", entityId: tapeId,
      payload: { rules: ruleDefs.length, records: result.rows.length,
                 exceptions: result.exceptions.length, suppressedDependent: result.suppressed, asOf },
    });

    const excRows = result.exceptions.map((e) => ({
      tapeId,
      recordId: e.recordId === null ? null : recordIdByIndex.get(Number(e.recordId)) ?? null,
      ruleId: ruleIdByCode.get(e.ruleCode)!,
      field: e.field, observed: e.observed, expected: e.expected,
      detail: (e.detail ?? null) as object | null,
      severity: e.severity, clusterKey: e.clusterKey ?? null,
    }));
    for (const c of chunk(excRows, 250)) {
      const inserted = await tx.insert(exceptions).values(c).returning({ id: exceptions.id, severity: exceptions.severity, ruleId: exceptions.ruleId });
      for (const row of inserted) {
        events.push({
          tapeId, actorId: session.userId, actorRole: session.role,
          action: "EXCEPTION_RAISED", entityType: "exception", entityId: row.id,
          payload: { severity: row.severity },
        });
      }
    }

    const blocking = excRows.filter((e) => e.severity === "BLOCKER" || e.severity === "CRITICAL").length;
    await tx.update(tapes).set({
      status: blocking > 0 ? "VALIDATED" : "IN_REVIEW",
      rowCount: result.rows.length,
    }).where(eq(tapes.id, tapeId));

    await tx.update(loanRecords).set({ verificationStatus: "EXCEPTION" })
      .where(eq(loanRecords.tapeId, tapeId));
    // records with no gating exception go back to PENDING (eligible for sign-off)
    const gatingRecordIds = new Set(
      result.exceptions.filter((e) => e.recordId !== null && (e.severity === "BLOCKER" || e.severity === "CRITICAL"))
        .map((e) => recordIdByIndex.get(Number(e.recordId))!));
    const cleanIds = [...recordIdByIndex.values()].filter((id) => !gatingRecordIds.has(id));
    for (const c of chunk(cleanIds, 500)) {
      await tx.update(loanRecords).set({ verificationStatus: "PENDING" })
        .where(and(eq(loanRecords.tapeId, tapeId), inArrayIds(c)));
    }

    await emitMany(tx, events);

    return {
      records: result.rows.length,
      exceptions: result.exceptions.length,
      conflicts: result.conflictCount,
      unmapped: result.unmapped,
      hints: result.hints,
      suppressed: result.suppressed,
      cleanRecords: cleanIds.length,
    };
  });
}

import { inArray } from "drizzle-orm";
const inArrayIds = (ids: string[]) => inArray(loanRecords.id, ids);
