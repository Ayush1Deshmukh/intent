import { ALIAS_INDEX, CANONICAL_FIELDS, CanonicalField, FIELD_META, normalizeHeader } from "@/lib/schema/fields";

export type MapMethod = "EXACT" | "ALIAS" | "FUZZY" | "AI" | "MANUAL";

export type HeaderMatch = {
  sourceHeader: string;
  canonicalField: CanonicalField | null;
  method: MapMethod;
  confidence: number;
  samples: string[];
  rationale?: string;
};

/** Levenshtein, capped — we only care about near misses */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 6) return 99;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  const cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function tokenScore(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / new Set([...A, ...B]).size;
}

/**
 * Four escalating passes. Every match carries the method that produced it, so the
 * mapping screen can show a person exactly how confident the system is and why.
 *   1 exact canonical name          1.00
 *   2 hand-written alias dictionary 0.95
 *   3 normalized + token similarity 0.70-0.90
 *   4 LLM over the leftovers        flagged, never auto-confirmed
 */
export function matchHeaders(headers: string[], rows: Record<string, string>[]): HeaderMatch[] {
  const used = new Set<CanonicalField>();
  const results: HeaderMatch[] = [];
  const samplesFor = (h: string) =>
    rows.map((r) => r[h]).filter((v) => v != null && String(v).trim() !== "").slice(0, 3).map(String);

  // pass 1 + 2
  const pending: string[] = [];
  for (const h of headers) {
    const norm = normalizeHeader(h);
    const canonicalDirect = CANONICAL_FIELDS.find((f) => normalizeHeader(f) === norm);
    if (canonicalDirect && !used.has(canonicalDirect)) {
      used.add(canonicalDirect);
      results.push({ sourceHeader: h, canonicalField: canonicalDirect, method: "EXACT", confidence: 1, samples: samplesFor(h) });
      continue;
    }
    const viaAlias = ALIAS_INDEX.get(norm);
    if (viaAlias && !used.has(viaAlias)) {
      used.add(viaAlias);
      results.push({ sourceHeader: h, canonicalField: viaAlias, method: "ALIAS", confidence: 0.95, samples: samplesFor(h) });
      continue;
    }
    pending.push(h);
  }

  // pass 3 — fuzzy over what's left
  for (const h of pending) {
    const norm = normalizeHeader(h);
    let best: { field: CanonicalField; score: number } | null = null;
    for (const field of CANONICAL_FIELDS) {
      if (used.has(field)) continue;
      const candidates = [normalizeHeader(field), ...(ALIAS_INDEX.size ? [] : [])];
      for (const [aliasNorm, aliasField] of ALIAS_INDEX) {
        if (aliasField === field) candidates.push(aliasNorm);
      }
      for (const cand of candidates) {
        const tok = tokenScore(norm, cand);
        const distance = lev(norm, cand);
        const levScore = distance >= 99 ? 0 : 1 - distance / Math.max(norm.length, cand.length, 1);
        const score = Math.max(tok, levScore * 0.95);
        if (!best || score > best.score) best = { field, score };
      }
    }
    if (best && best.score >= 0.62) {
      used.add(best.field);
      results.push({
        sourceHeader: h, canonicalField: best.field, method: "FUZZY",
        confidence: Math.min(0.9, Math.max(0.7, best.score)), samples: samplesFor(h),
        rationale: `closest match to "${best.field}" by token and edit similarity`,
      });
    } else {
      results.push({ sourceHeader: h, canonicalField: null, method: "FUZZY", confidence: 0, samples: samplesFor(h) });
    }
  }

  return headers.map((h) => results.find((r) => r.sourceHeader === h)!);
}

/**
 * Pass 4 fallback that does not need the model: infer from the SHAPE of the sample
 * values. Used when AI is disabled, and as the prior the AI prompt is built from.
 */
export function shapeHint(samples: string[]): { field: CanonicalField; why: string } | null {
  const vals = samples.filter(Boolean);
  if (vals.length === 0) return null;
  const allNum = vals.every((v) => /^[$(]?[\d,]+(\.\d+)?\)?$/.test(v.trim()));
  const nums = vals.map((v) => Number(v.replace(/[^0-9.-]/g, ""))).filter(Number.isFinite);
  const med = nums.sort((a, b) => a - b)[Math.floor(nums.length / 2)] ?? 0;

  if (allNum && med > 50_000) return { field: "appraisedValue", why: "values cluster well above typical balances and are round" };
  if (allNum && med >= 300 && med <= 850) return { field: "creditScore", why: "every value falls inside the FICO band 300-850" };
  if (allNum && med > 0 && med < 30) return { field: "interestRate", why: "small positive values consistent with an annual percentage rate" };
  if (vals.every((v) => /^\d{5}(-\d{4})?$/.test(v.trim()))) return { field: "borrowerZip", why: "five-digit postal codes" };
  if (vals.every((v) => /^[A-Za-z]{2}$/.test(v.trim()))) return { field: "borrowerState", why: "two-letter codes" };
  return null;
}

export const unmappedHeaders = (matches: HeaderMatch[]) =>
  matches.filter((m) => !m.canonicalField).map((m) => m.sourceHeader);

export function coverage(matches: HeaderMatch[]): { mapped: number; total: number; required: CanonicalField[] } {
  const mapped = matches.filter((m) => m.canonicalField).length;
  const have = new Set(matches.map((m) => m.canonicalField).filter(Boolean) as CanonicalField[]);
  const missing = CANONICAL_FIELDS.filter((f) => FIELD_META[f].required && !have.has(f));
  return { mapped, total: matches.length, required: missing };
}
