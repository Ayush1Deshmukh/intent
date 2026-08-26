import Decimal from "decimal.js";
import { CANONICAL_FIELDS, CanonicalField } from "@/lib/schema/fields";
import { US_STATES } from "@/lib/coerce/state";
import { amortPayment, CanonicalRecord, EvalCtx, evaluate, Expr, TapeStats } from "./dsl";
import { RuleDef } from "./catalog";

export type EngineRecord = {
  id: string;
  loanId: string | null;
  values: CanonicalRecord;
  errors: Partial<Record<CanonicalField, string>>;
  conflicts: Partial<Record<CanonicalField, { primary: string; secondary: string; source: string }>>;
};

export type ExceptionDraft = {
  recordId: string | null;
  ruleCode: string;
  field: string | null;
  observed: string | null;
  expected: string;
  severity: RuleDef["severity"];
  detail?: unknown;
  clusterKey?: string;
};

export function computeStats(records: EngineRecord[]): TapeStats {
  const numericFields: CanonicalField[] = ["interestRate", "currentBalance", "originalPrincipal", "creditScore", "termMonths"];
  const numeric: Record<string, { mean: number; sd: number }> = {};
  for (const f of numericFields) {
    const xs = records.map((r) => Number(r.values[f])).filter((n) => Number.isFinite(n));
    if (xs.length === 0) { numeric[f] = { mean: 0, sd: 0 }; continue; }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    numeric[f] = { mean, sd };
  }

  const nullRate: Record<string, number> = {};
  for (const f of CANONICAL_FIELDS) {
    const empty = records.filter((r) => {
      const v = r.values[f];
      return v === null || v === undefined || v === "";
    }).length;
    nullRate[f] = records.length ? empty / records.length : 0;
  }

  const seen = new Map<string, number>();
  for (const r of records) if (r.values.loanId) {
    const k = String(r.values.loanId);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const duplicateLoanIds = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));

  const comp = new Map<string, number>();
  for (const r of records) if (!r.values.loanId) {
    const k = ["borrowerId", "originalPrincipal", "originationDate"].map((f) => String(r.values[f as CanonicalField] ?? "")).join("|");
    if (k.replace(/\|/g, "")) comp.set(k, (comp.get(k) ?? 0) + 1);
  }
  const duplicateCompound = new Set([...comp].filter(([, n]) => n > 1).map(([k]) => k));

  return { count: records.length, numeric, nullRate, duplicateLoanIds, duplicateCompound };
}

const US_SET = new Set(Object.keys(US_STATES));

export type RunResult = { drafts: ExceptionDraft[]; suppressed: number };

export function runRules(
  records: EngineRecord[],
  ruleDefs: RuleDef[],
  opts: { servicers: Set<string>; asOf: string; unmappedHeaders?: string[] },
): ExceptionDraft[] {
  return runRulesDetailed(records, ruleDefs, opts).drafts;
}

export function runRulesDetailed(
  records: EngineRecord[],
  ruleDefs: RuleDef[],
  opts: { servicers: Set<string>; asOf: string; unmappedHeaders?: string[] },
): RunResult {
  const stats = computeStats(records);
  const refs = { usStates: US_SET, servicers: opts.servicers };
  const out: ExceptionDraft[] = [];

  const recordRules = ruleDefs.filter((r) => r.scope === "record");
  const tapeRules = ruleDefs.filter((r) => r.scope === "tape");

  let suppressed = 0;

  for (const rec of records) {
    const ctx: EvalCtx = { record: rec.values, errors: rec.errors, conflicts: rec.conflicts, stats, refs, asOf: opts.asOf };

    // Pass A — which rules fire at all
    const firedRules: RuleDef[] = [];
    for (const rule of recordRules) {
      try { if (evaluate(rule.expression as Expr, ctx)) firedRules.push(rule); }
      catch { /* a rule that throws is a rule that does not fire */ }
    }

    // Pass B — a field is "already known bad" if a gating rule about it fired
    const knownBad = new Set<CanonicalField>();
    for (const rule of firedRules) {
      if (rule.field && (rule.severity === "BLOCKER" || rule.severity === "CRITICAL")) knownBad.add(rule.field);
    }
    for (const f of Object.keys(rec.errors) as CanonicalField[]) knownBad.add(f);

    for (const rule of firedRules) {
      // suppress a rule that reasons FROM a field already flagged — otherwise one
      // bad rate fires the range rule and the amortization rule, and the repair for
      // the second is derived from the value the first says is wrong
      const inputsBad = (rule.dependsOn ?? []).some((f) => f !== rule.field && knownBad.has(f));
      if (inputsBad) { suppressed++; continue; }

      const field = rule.code === "CON-001"
        ? ((Object.keys(rec.conflicts)[0] as typeof rule.field) ?? rule.field)
        : rule.field;
      const observed = field ? renderObserved(rec, field, rule) : null;
      out.push({
        recordId: rec.id, ruleCode: rule.code, field,
        observed, expected: renderExpected(rule, ctx),
        severity: rule.severity,
        detail: rule.code === "CON-001" ? rec.conflicts : undefined,
        clusterKey: deterministicCluster(rec, rule),
      });
    }
  }

  // tape-scoped pass
  const tapeCtx: EvalCtx = {
    record: {}, errors: {}, conflicts: {},
    stats, refs, asOf: opts.asOf,
  };
  for (const rule of tapeRules) {
    if (rule.code === "STR-004") {
      for (const h of opts.unmappedHeaders ?? []) {
        out.push({
          recordId: null, ruleCode: rule.code, field: null,
          observed: h, expected: rule.expected, severity: rule.severity,
          detail: { sourceHeader: h },
        });
      }
      continue;
    }
    let fired = false;
    try { fired = evaluate(rule.expression as Expr, tapeCtx); } catch { fired = false; }
    if (fired) {
      const rate = rule.field ? stats.nullRate[rule.field] : undefined;
      out.push({
        recordId: null, ruleCode: rule.code, field: rule.field,
        observed: rate !== undefined ? `${(rate * 100).toFixed(1)}% empty` : String(stats.count),
        expected: rule.expected, severity: rule.severity,
      });
    }
  }

  return { drafts: out, suppressed };
}

function renderObserved(rec: EngineRecord, field: CanonicalField, rule: RuleDef): string | null {
  if (rec.errors[field]) return rec.errors[field]!;
  const v = rec.values[field];
  if (rule.code === "XFD-003") {
    return `${v} (amortizing payment is ${fmtAmort(rec)})`;
  }
  if (rule.code === "CON-001") {
    const c = Object.entries(rec.conflicts)[0];
    return c ? `${c[0]}: tape ${c[1]!.primary} vs ${c[1]!.source} ${c[1]!.secondary}` : String(v ?? "");
  }
  return v === null || v === undefined ? null : String(v);
}

function fmtAmort(rec: EngineRecord): string {
  const p = amortPayment({
    record: rec.values, errors: {}, conflicts: {},
    stats: { count: 0, numeric: {}, nullRate: {}, duplicateLoanIds: new Set(), duplicateCompound: new Set() },
    refs: { usStates: US_SET, servicers: new Set() }, asOf: "2026-01-01",
  });
  return p ? p.toFixed(2) : "unknown";
}

function renderExpected(rule: RuleDef, ctx: EvalCtx): string {
  if (rule.code === "XFD-003") {
    const p = amortPayment(ctx);
    return p ? `${p.toFixed(2)} ±2%` : rule.expected;
  }
  return rule.expected;
}

/**
 * Deterministic root-cause key. This is the FALLBACK behind the AI cluster job —
 * and on the demo tape it recovers the date-format cluster on its own.
 */
function deterministicCluster(rec: EngineRecord, rule: RuleDef): string | undefined {
  // every date-shaped failure rolls up to one root cause: the column arrived in
  // two orderings, so some rows are unparseable and others parsed the wrong way
  if (["FMT-001", "FMT-002", "XFD-002", "XFD-006", "STA-002"].includes(rule.code)) {
    return "date-format-mismatch";
  }
  if (rule.code === "CON-001") return "source-conflict";
  return `${rule.code}`;
}

/* ------------------------------------------------------------------------ */
/* Deterministic repairs — the propose fallback. Nine rules have one.        */
/* ------------------------------------------------------------------------ */

export type Repair = { field: CanonicalField; toValue: string | null; rationale: string; confidence: number };

export function deterministicRepair(
  rule: RuleDef,
  rec: EngineRecord,
  raw: Partial<Record<CanonicalField, string>>,
): Repair | null {
  const v = rec.values;
  switch (rule.repairHint) {
    case "payment.amortizing": {
      const p = amortPayment({
        record: v, errors: {}, conflicts: {},
        stats: { count: 0, numeric: {}, nullRate: {}, duplicateLoanIds: new Set(), duplicateCompound: new Set() },
        refs: { usStates: US_SET, servicers: new Set() }, asOf: "2026-01-01",
      });
      if (!p) return null;
      return { field: "paymentAmount", toValue: p.toFixed(2), confidence: 0.75,
        rationale: `The amortizing payment for ${v.originalPrincipal} over ${v.termMonths} months at ${v.interestRate}% is ${p.toFixed(2)}. The stated payment differs by more than the 2% tolerance.` };
    }
    case "balance.clampToOriginal":
      if (!v.originalPrincipal) return null;
      return { field: "currentBalance", toValue: String(v.originalPrincipal), confidence: 0.55,
        rationale: "The outstanding balance cannot exceed the amount originally funded; the original principal is the highest defensible value without a servicer figure to confirm." };
    case "balance.zeroOnPayoff":
      return { field: "currentBalance", toValue: "0.00", confidence: 0.6,
        rationale: "The loan is reported as paid off, so the outstanding balance should be zero." };
    case "status.fromDpd": {
      const dpd = Number(v.daysPastDue ?? 0);
      const to = dpd >= 90 ? "DEFAULT" : "DELINQUENT";
      return { field: "paymentStatus", toValue: to, confidence: 0.7,
        rationale: `The record carries ${dpd} days past due, which is inconsistent with a current status. ${dpd >= 90 ? "Ninety days or more is conventionally treated as default." : "Any positive days past due makes the loan delinquent."}` };
    }
    case "zip.pad": {
      const r = raw.borrowerZip ?? "";
      const digits = r.replace(/\D/g, "");
      if (digits.length >= 3 && digits.length <= 4) {
        return { field: "borrowerZip", toValue: digits.padStart(5, "0"), confidence: 0.8,
          rationale: "The postal code has fewer than five digits, the signature of a spreadsheet stripping a leading zero." };
      }
      return null;
    }
    case "rate.rescale": {
      const n = Number(v.interestRate);
      if (!Number.isFinite(n)) return null;
      if (n > 25 && n / 100 <= 25) return { field: "interestRate", toValue: (n / 100).toFixed(4), confidence: 0.65,
        rationale: "The rate is above 25%, and dividing by 100 puts it in the normal band — this column mixed basis points or decimal form with percent form." };
      if (n < 1 && n > 0) return { field: "interestRate", toValue: (n * 100).toFixed(4), confidence: 0.65,
        rationale: "The rate is below 1%, and multiplying by 100 puts it in the normal band — this value was left in decimal form." };
      return null;
    }
    case "abs": {
      const n = Number(v.currentBalance);
      if (!Number.isFinite(n) || n >= 0) return null;
      return { field: "currentBalance", toValue: Math.abs(n).toFixed(2), confidence: 0.5,
        rationale: "The balance is negative, which is usually an accounting sign convention leaking in from the export rather than a real credit." };
    }
    case "date.clearPlaceholder":
      return { field: "originationDate", toValue: null, confidence: 0.6,
        rationale: "This is a well-known placeholder date written by legacy systems when the real date is unknown; clearing it is more honest than carrying a false date forward." };
    case "term.fromDates": {
      const a = v.originationDate, b = v.maturityDate;
      if (!a || !b) return null;
      const months = Math.round((Date.parse(String(b)) - Date.parse(String(a))) / (86400000 * 30.4375));
      if (months < 1 || months > 480) return null;
      return { field: "termMonths", toValue: String(months), confidence: 0.6,
        rationale: `The gap between origination and maturity is about ${months} months, which is the term the dates imply.` };
    }
    case "conflict.adoptNewer": {
      const entry = Object.entries(rec.conflicts)[0];
      if (!entry) return null;
      const [field, c] = entry as [CanonicalField, { primary: string; secondary: string; source: string }];
      return { field, toValue: c.secondary, confidence: 0.7,
        rationale: `The ${c.source} carries a later as-of date than the loan tape, so its value (${c.secondary}) is the more recent statement of this field.` };
    }
    case "state.fuzzy":
      return null; // already attempted at coercion; a failure here needs a human
    case "dates.swapOrReparse":
      return null;
    default:
      return null;
  }
}

export function severityWeight(s: RuleDef["severity"]): number {
  return { BLOCKER: 0, CRITICAL: 1, WARNING: 2, INFO: 3 }[s];
}

export const GATING_SEVERITIES: RuleDef["severity"][] = ["BLOCKER", "CRITICAL"];
export const isGating = (s: string) => s === "BLOCKER" || s === "CRITICAL";
export { Decimal };
