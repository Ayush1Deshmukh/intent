/**
 * The validation DSL.
 *
 * A rule's expression DESCRIBES THE VIOLATION — it fires when it evaluates true.
 * Rules live in the database as JSON, not in code, so the AI can author them, the
 * UI can list them, and the engine extends without a redeploy.
 *
 * Three semantics that are easy to get wrong and expensive to get wrong:
 *
 *  1. NULL IS NOT A VIOLATION. Any comparison touching a null term is false.
 *     Missing-value rules say `isNull` explicitly. Without this, one blank FICO
 *     fires four range rules and the exception count becomes noise.
 *  2. Numeric comparisons go through Decimal, never JS `<` on floats. Tolerances
 *     are explicit constants in the expression, never implicit float slack.
 *  3. Tape-scoped rules (nullRate, zscore, duplicate, conflict) run in a second
 *     pass once every record is normalized.
 */
import Decimal from "decimal.js";
import type { CanonicalField } from "@/lib/schema/fields";

export type Term =
  | { field: CanonicalField }
  | { const: number | string | null }
  | { calc: "mul" | "div" | "add" | "sub" | "mod"; args: [Term, Term] }
  | { fn: "abs"; args: [Term] }
  | { fn: "monthsBetween" | "daysBetween"; args: [Term, Term] }
  | { fn: "amortPayment" }
  | { fn: "today" };

export type Expr =
  | { op: "and" | "or"; args: Expr[] }
  | { op: "not"; arg: Expr }
  | { op: "cmp"; left: Term; cmp: "gt" | "gte" | "lt" | "lte" | "eq" | "neq"; right: Term }
  | { op: "isNull" | "notNull"; field: CanonicalField }
  | { op: "in"; field: CanonicalField; values: (string | number)[] }
  | { op: "notIn"; field: CanonicalField; ref: "usStates" | "servicers" }
  | { op: "matches"; field: CanonicalField; pattern: string; negate?: boolean }
  | { op: "between"; field: CanonicalField; min: number; max: number; negate?: boolean }
  | { op: "duplicate"; field: CanonicalField }
  | { op: "compoundDuplicate"; fields: CanonicalField[] }
  | { op: "parseError"; field: CanonicalField }
  | { op: "conflict"; field?: CanonicalField }
  | { op: "stale"; field: CanonicalField; days: number }
  | { op: "zscore"; field: CanonicalField; gt: number }
  | { op: "nullRate"; field: CanonicalField; gt: number }
  | { op: "rowCountZero" };

export type CanonicalRecord = Partial<Record<CanonicalField, string | number | null>>;

export type TapeStats = {
  count: number;
  numeric: Record<string, { mean: number; sd: number }>;
  nullRate: Record<string, number>;
  duplicateLoanIds: Set<string>;
  duplicateCompound: Set<string>;
};

export type EvalCtx = {
  record: CanonicalRecord;
  errors: Partial<Record<CanonicalField, string>>;
  conflicts: Partial<Record<CanonicalField, { primary: string; secondary: string; source: string }>>;
  stats: TapeStats;
  refs: { usStates: Set<string>; servicers: Set<string> };
  /** reporting date the tape is being validated against — drives staleness */
  asOf: string;
};

const DAY = 86400000;
const toDays = (iso: string) => Math.floor(Date.parse(iso.length <= 10 ? iso + "T00:00:00Z" : iso) / DAY);

function num(v: unknown): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? new Decimal(v) : null;
  if (typeof v === "string") {
    // ISO date or timestamp -> epoch days, so date comparisons work in the same lane
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = toDays(v);
      return Number.isFinite(d) ? new Decimal(d) : null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? new Decimal(n) : null;
  }
  return null;
}

/** amortizing monthly payment from original principal, rate and term */
export function amortPayment(ctx: EvalCtx): Decimal | null {
  const p = num(ctx.record.originalPrincipal);
  const rate = num(ctx.record.interestRate);
  const n = num(ctx.record.termMonths);
  if (!p || !rate || !n || n.lte(0) || p.lte(0)) return null;
  const r = rate.div(100).div(12);
  if (r.lte(0)) return p.div(n);
  const factor = r.plus(1).pow(-n.toNumber());
  const denom = new Decimal(1).minus(factor);
  if (denom.lte(0)) return null;
  return p.mul(r).div(denom);
}

export function evalTerm(t: Term, ctx: EvalCtx): Decimal | null {
  if ("field" in t) return num(ctx.record[t.field]);
  if ("const" in t) return t.const === null ? null : num(t.const);
  if ("calc" in t) {
    const a = evalTerm(t.args[0], ctx);
    const b = evalTerm(t.args[1], ctx);
    if (a === null || b === null) return null;
    switch (t.calc) {
      case "mul": return a.mul(b);
      case "div": return b.isZero() ? null : a.div(b);
      case "add": return a.plus(b);
      case "sub": return a.minus(b);
      case "mod": return b.isZero() ? null : a.mod(b);
    }
  }
  if ("fn" in t) {
    switch (t.fn) {
      case "abs": {
        const a = evalTerm(t.args[0], ctx);
        return a === null ? null : a.abs();
      }
      case "daysBetween": {
        const a = evalTerm(t.args[0], ctx); const b = evalTerm(t.args[1], ctx);
        return a === null || b === null ? null : b.minus(a);
      }
      case "monthsBetween": {
        const a = evalTerm(t.args[0], ctx); const b = evalTerm(t.args[1], ctx);
        return a === null || b === null ? null : b.minus(a).div(30.4375);
      }
      case "amortPayment": return amortPayment(ctx);
      case "today": return new Decimal(toDays(ctx.asOf));
    }
  }
  return null;
}

export function evaluate(e: Expr, ctx: EvalCtx): boolean {
  switch (e.op) {
    case "and": return e.args.every((a) => evaluate(a, ctx));
    case "or":  return e.args.some((a) => evaluate(a, ctx));
    case "not": return !evaluate(e.arg, ctx);

    case "cmp": {
      const l = evalTerm(e.left, ctx);
      const r = evalTerm(e.right, ctx);
      // string equality lane for enums
      if (l === null || r === null) {
        if (e.cmp === "eq" || e.cmp === "neq") {
          const lv = "field" in e.left ? ctx.record[e.left.field] : ("const" in e.left ? e.left.const : null);
          const rv = "field" in e.right ? ctx.record[e.right.field] : ("const" in e.right ? e.right.const : null);
          if (typeof lv === "string" && typeof rv === "string") {
            return e.cmp === "eq" ? lv === rv : lv !== rv;
          }
        }
        return false; // NULL IS NOT A VIOLATION
      }
      switch (e.cmp) {
        case "gt":  return l.gt(r);
        case "gte": return l.gte(r);
        case "lt":  return l.lt(r);
        case "lte": return l.lte(r);
        case "eq":  return l.eq(r);
        case "neq": return !l.eq(r);
      }
    }

    case "isNull":  { const v = ctx.record[e.field]; return v === null || v === undefined || v === ""; }
    case "notNull": { const v = ctx.record[e.field]; return !(v === null || v === undefined || v === ""); }

    case "in": {
      const v = ctx.record[e.field];
      if (v === null || v === undefined || v === "") return false;
      return e.values.some((x) => String(x) === String(v));
    }

    case "notIn": {
      const v = ctx.record[e.field];
      if (v === null || v === undefined || v === "") return false;
      const set = e.ref === "usStates" ? ctx.refs.usStates : ctx.refs.servicers;
      return !set.has(String(v).toUpperCase());
    }

    case "matches": {
      const v = ctx.record[e.field];
      if (v === null || v === undefined || v === "") return false;
      const hit = new RegExp(e.pattern).test(String(v));
      return e.negate ? !hit : hit;
    }

    case "between": {
      const v = num(ctx.record[e.field]);
      if (v === null) return false;
      const inside = v.gte(e.min) && v.lte(e.max);
      return e.negate ? !inside : inside;
    }

    case "duplicate": {
      const v = ctx.record[e.field];
      if (v === null || v === undefined || v === "") return false;
      return ctx.stats.duplicateLoanIds.has(String(v));
    }

    case "compoundDuplicate": {
      if (ctx.record.loanId) return false; // only meaningful when the id is missing
      const key = e.fields.map((f) => String(ctx.record[f] ?? "")).join("|");
      if (key.replace(/\|/g, "") === "") return false;
      return ctx.stats.duplicateCompound.has(key);
    }

    case "parseError": return Boolean(ctx.errors[e.field]);

    case "conflict":
      return e.field ? Boolean(ctx.conflicts[e.field]) : Object.keys(ctx.conflicts).length > 0;

    case "stale": {
      const v = ctx.record[e.field];
      if (!v) return false;
      const age = toDays(ctx.asOf) - toDays(String(v));
      return age > e.days;
    }

    case "zscore": {
      const v = num(ctx.record[e.field]);
      const s = ctx.stats.numeric[e.field];
      if (!v || !s || s.sd === 0) return false;
      return Math.abs(v.toNumber() - s.mean) / s.sd > e.gt;
    }

    case "nullRate": return (ctx.stats.nullRate[e.field] ?? 0) > e.gt;

    case "rowCountZero": return ctx.stats.count === 0;
  }
}

/** human-readable rendering of an expression, used in the rule library UI */
export function describeExpr(e: Expr): string {
  const t = (x: Term): string => {
    if ("field" in x) return x.field;
    if ("const" in x) return String(x.const);
    if ("calc" in x) return `(${t(x.args[0])} ${({ mul: "×", div: "÷", add: "+", sub: "−", mod: "mod" } as const)[x.calc]} ${t(x.args[1])})`;
    if (x.fn === "amortPayment") return "amortizingPayment()";
    if (x.fn === "today") return "today";
    if (x.fn === "abs") return `|${t(x.args[0])}|`;
    return `${x.fn}(${t(x.args[0])}, ${t(x.args[1])})`;
  };
  const c = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠" } as const;
  switch (e.op) {
    case "and": return e.args.map(describeExpr).join(" AND ");
    case "or":  return e.args.map(describeExpr).join(" OR ");
    case "not": return `NOT (${describeExpr(e.arg)})`;
    case "cmp": return `${t(e.left)} ${c[e.cmp]} ${t(e.right)}`;
    case "isNull": return `${e.field} is empty`;
    case "notNull": return `${e.field} is present`;
    case "in": return `${e.field} in [${e.values.join(", ")}]`;
    case "notIn": return `${e.field} not in ${e.ref}`;
    case "matches": return `${e.field} ${e.negate ? "does not match" : "matches"} /${e.pattern}/`;
    case "between": return `${e.field} ${e.negate ? "outside" : "within"} ${e.min}..${e.max}`;
    case "duplicate": return `${e.field} appears more than once`;
    case "compoundDuplicate": return `duplicate combination of ${e.fields.join(" + ")}`;
    case "parseError": return `${e.field} could not be interpreted`;
    case "conflict": return e.field ? `${e.field} conflicts across sources` : "any field conflicts across sources";
    case "stale": return `${e.field} older than ${e.days} days`;
    case "zscore": return `${e.field} more than ${e.gt}σ from the portfolio mean`;
    case "nullRate": return `${e.field} empty in more than ${Math.round(e.gt * 100)}% of rows`;
    case "rowCountZero": return "tape has no rows";
  }
}
