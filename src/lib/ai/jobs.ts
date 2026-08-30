import { and, eq, inArray } from "drizzle-orm";
import { db, exceptions, rules, loanRecords } from "@/lib/db";
import { CANONICAL_FIELDS, FIELD_META } from "@/lib/schema/fields";
import { describeExpr } from "@/lib/rules/dsl";
import { callModel, redact, aiEnabled } from "./client";
import { AuthorOut, ClusterOut, ExplainOut, ProposeOut } from "./schemas";
import { loadExceptionContext, recordValues, deterministicProposal } from "@/lib/service/review";
import { RULE_BY_CODE } from "@/lib/rules/catalog";

/* --------------------------------------------------------------- 1 EXPLAIN */

const EXPLAIN_SYSTEM = `You explain loan-data exceptions to a data analyst.

You are given one validation rule, one loan record, and the raw values exactly as
they arrived from the source file. Answer in three short parts:
  whatTheRuleChecks - what the rule is testing, in plain language
  likelyCause       - the most probable reason THIS row failed it
  downstreamRisk    - what goes wrong if it is left unfixed

Never suggest a specific corrected value here; that is a separate step.
Never mention that you are an AI model. Return JSON only, no prose around it.`;

export async function explainException(exceptionId: string) {
  const ctx = await loadExceptionContext(exceptionId);
  const rule = ctx.rule;

  const user = JSON.stringify({
    rule: { code: rule.code, name: rule.name, description: rule.description,
            severity: rule.severity, expression: describeExpr(rule.expression as never) },
    exception: { field: ctx.exc.field, observed: ctx.exc.observed, expected: ctx.exc.expected },
    record: ctx.rec ? redact(recordValues(ctx.rec) as Record<string, unknown>) : null,
    rawRow: ctx.raw ? redact(ctx.raw.original as Record<string, unknown>) : null,
  }, null, 1);

  const res = await callModel("explain", EXPLAIN_SYSTEM, user, ExplainOut);
  if (res.ok) return { ...res.data, source: res.source, model: res.model };

  // deterministic fallback — the rule's own words plus what was actually seen
  return {
    whatTheRuleChecks: rule.description,
    likelyCause: ctx.exc.observed
      ? `This row reported ${ctx.exc.field ?? "a value"} as "${ctx.exc.observed}", where the rule expects ${ctx.exc.expected}.`
      : `The rule expects ${ctx.exc.expected}.`,
    downstreamRisk: rule.severity === "BLOCKER" || rule.severity === "CRITICAL"
      ? "This is a gating exception: the tape cannot be signed off while it is open, because every aggregate computed from this loan would inherit the error."
      : "This is recorded but not gating. It can be waived with a written reason if the originator confirms the value is correct.",
    source: "RULE" as const,
    model: null,
  };
}

/* --------------------------------------------------------------- 2 PROPOSE */

const PROPOSE_SYSTEM = `You propose a single corrected value for ONE field of ONE loan record.

You are given the raw value exactly as it arrived, every transformation already
applied to it, the rule that failed, and comparable rows from the same tape.

Return JSON only: { field, toValue, rationale, confidence, evidence }.
 - confidence below 0.6 whenever the raw value is genuinely ambiguous
 - if no correction is defensible, return toValue "" and confidence 0
 - evidence is up to 5 {label, value} pairs a reviewer can check for themselves

You cannot write to the database. Your output is a proposal a human will review,
accept or reject, and a second human must then approve.`;

export async function proposeFix(exceptionId: string) {
  const ctx = await loadExceptionContext(exceptionId);
  const fallback = await deterministicProposal(exceptionId);

  const peers = ctx.rec
    ? await db.select({ loanId: loanRecords.loanId, v: loanRecords })
        .from(loanRecords).where(eq(loanRecords.tapeId, ctx.exc.tapeId)).limit(5)
    : [];

  const user = JSON.stringify({
    rule: { code: ctx.rule.code, name: ctx.rule.name, description: ctx.rule.description },
    field: ctx.exc.field,
    observed: ctx.exc.observed,
    expected: ctx.exc.expected,
    rawRow: ctx.raw ? redact(ctx.raw.original as Record<string, unknown>) : null,
    record: ctx.rec ? redact(recordValues(ctx.rec) as Record<string, unknown>) : null,
    comparableRows: peers.slice(0, 5).map((p) => redact(recordValues(p.v) as Record<string, unknown>)),
    deterministicSuggestion: fallback,
  }, null, 1);

  const res = await callModel("propose", PROPOSE_SYSTEM, user, ProposeOut);
  if (res.ok) {
    return {
      field: res.data.field, toValue: res.data.toValue === "" ? null : res.data.toValue,
      rationale: res.data.rationale, confidence: res.data.confidence,
      evidence: res.data.evidence, source: "AI" as const, model: res.model,
      promptHash: res.promptHash, promptText: res.promptText, responseText: res.responseText,
      tokensIn: res.tokensIn, tokensOut: res.tokensOut, latencyMs: res.latencyMs,
    };
  }

  if (!fallback) return null;
  return {
    field: fallback.field, toValue: fallback.toValue, rationale: fallback.rationale,
    confidence: fallback.confidence, source: "RULE" as const, model: null,
    promptHash: res.promptHash, promptText: null, responseText: null,
    tokensIn: null, tokensOut: null, latencyMs: null,
    evidence: [
      { label: "rule", value: `${ctx.rule.code} ${ctx.rule.name}` },
      { label: "observed", value: ctx.exc.observed ?? "" },
      { label: "expected", value: ctx.exc.expected ?? "" },
      { label: "derived by", value: "deterministic repair, no model involved" },
    ],
  };
}

/* --------------------------------------------------------------- 3 CLUSTER */

const CLUSTER_SYSTEM = `You name the ROOT CAUSES behind a set of loan-data exceptions.

You are given BUCKETS, not individual rows. Each bucket is a group the system has
already formed, with an exact count. Your job is to merge the buckets that share one
underlying cause and to name that cause in a sentence an analyst would act on.

A good cluster names something that happened to the FILE - a column written in two
date orderings, a rate column left in decimal form, a servicer feed that lags - so
that one decision resolves many rows. Return 3 to 8 clusters. Put each bucket key in
at most one cluster; leave out any you cannot place. Use the keys exactly as given.

Return JSON only.`;

export type Cluster = {
  key: string; label: string; rootCause: string;
  exceptionIds: string[]; suggestedAction: string; confidence: number;
  source: "AI" | "RULE" | "CACHE";
};

/**
 * Group the open exceptions by root cause.
 *
 * The division of labour matters here, and an earlier version got it wrong. The model
 * is asked to name causes and merge buckets — which is what it is good at — and is
 * never asked to assign individual exceptions to them. Membership is computed from the
 * deterministic buckets, so **every count is exact and complete**.
 *
 * The earlier version sent the model a 120-row sample of the queue and used its row
 * assignments directly. It ran, and the answers read well, but a cause that actually
 * affected 45 loans was reported as affecting 5 — because 5 was all the model had been
 * shown. A confident, well-written, wrong number is worse than a plain one, and a
 * reviewer prioritising by count would have been misled by it.
 *
 * Sending buckets instead also makes the prompt tiny: about thirty rows rather than a
 * hundred and twenty, which is what lets it run inside a free tier's per-minute budget.
 */
export async function clusterExceptions(tapeId: string): Promise<Cluster[]> {
  const open = await db.select({ exc: exceptions, rule: rules })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .where(and(eq(exceptions.tapeId, tapeId), inArray(exceptions.status, ["OPEN"])));

  if (open.length === 0) return [];

  // The buckets. `clusterKey` is set by the pipeline where it already knows two rules
  // share a cause (the date orderings); otherwise a bucket is one rule.
  const groups = new Map<string, typeof open>();
  for (const row of open) {
    const key = row.exc.clusterKey ?? row.rule.code;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const LABELS: Record<string, { label: string; cause: string; action: string }> = {
    "date-format-mismatch": {
      label: "Dates arrived in two different orderings",
      cause: "The origination column contains both DD/MM and MM/DD values, so some rows cannot be read at all and others were read the wrong way round, which then breaks the term and maturity checks.",
      action: "Confirm which rows came from which servicer feed, re-read that subset as DD/MM, and re-run validation.",
    },
    "source-conflict": {
      label: "The servicer update disagrees with the loan tape",
      cause: "The servicer extract carries a later report date and different balances for these loans; the tape has not been refreshed since.",
      action: "Adopt the servicer figure where its report date is newer, one loan at a time, with the difference shown.",
    },
  };

  const deterministic: Cluster[] = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
    .map(([key, rows]) => {
      const known = LABELS[key];
      const rule = rows[0].rule;
      return {
        key,
        label: known?.label ?? `${rule.name} (${rows.length} rows)`,
        rootCause: known?.cause ?? rule.description,
        exceptionIds: rows.map((r) => r.exc.id),
        suggestedAction: known?.action ?? `Review the ${rows.length} rows failing ${rule.code} together — they share one rule and one field.`,
        confidence: known ? 0.9 : 0.7,
        source: "RULE" as const,
      };
    });

  if (!aiEnabled()) return deterministic;

  // one line per bucket: the key, how many loans it holds, the rule behind it, and a
  // single example of what the values actually look like
  const buckets = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      rule: rows[0].rule.code,
      field: rows[0].exc.field,
      description: RULE_BY_CODE.get(rows[0].rule.code)?.description ?? rows[0].rule.description,
      example: (rows[0].exc.observed ?? "").slice(0, 48),
    }));

  const user = JSON.stringify({ buckets });

  const res = await callModel("cluster", CLUSTER_SYSTEM, user, ClusterOut);
  if (!res.ok) return deterministic;

  const seen = new Set<string>();
  const clusters = res.data.clusters
    .map((c) => {
      // expand the bucket keys back to every exception they hold — the model never
      // sees, and never has to be trusted with, individual rows
      const ids: string[] = [];
      for (const key of c.bucketKeys) {
        if (seen.has(key)) continue;          // one bucket, one cluster
        const rows = groups.get(key);
        if (!rows) continue;                  // a key the model invented
        seen.add(key);
        ids.push(...rows.map((r) => r.exc.id));
      }
      return {
        key: c.key, label: c.label, rootCause: c.rootCause,
        suggestedAction: c.suggestedAction, confidence: c.confidence,
        exceptionIds: ids, source: res.source,
      };
    })
    .filter((c) => c.exceptionIds.length > 0)
    .sort((a, b) => b.exceptionIds.length - a.exceptionIds.length);

  // Anything the model left out still has to be actionable, so unplaced buckets come
  // back on their deterministic labels rather than vanishing from the queue.
  const leftovers = deterministic.filter((d) => !seen.has(d.key));
  return [...clusters, ...leftovers].slice(0, 8);
}

/* ---------------------------------------------------------------- 4 AUTHOR */

const DSL_DOC = `Expression grammar (the expression must describe the VIOLATION - it is true when the row is BAD):
  {op:"and"|"or", args:[Expr]}            {op:"not", arg:Expr}
  {op:"cmp", left:Term, cmp:"gt"|"gte"|"lt"|"lte"|"eq"|"neq", right:Term}
  {op:"isNull"|"notNull", field}          {op:"in", field, values:[]}
  {op:"notIn", field, ref:"usStates"|"servicers"}
  {op:"matches", field, pattern, negate?} {op:"between", field, min, max, negate?}
  {op:"duplicate", field}                 {op:"stale", field, days}
  {op:"zscore", field, gt}                {op:"nullRate", field, gt}
Term = {field} | {const} | {calc:"mul"|"div"|"add"|"sub"|"mod", args:[Term,Term]}
     | {fn:"abs", args:[Term]} | {fn:"monthsBetween"|"daysBetween", args:[Term,Term]}
     | {fn:"amortPayment"}`;

const AUTHOR_SYSTEM = `You translate an analyst's sentence into a validation rule.

${DSL_DOC}

Fields you may use, with their types:
${CANONICAL_FIELDS.map((f) => `  ${f} (${FIELD_META[f].kind})`).join("\n")}

Rates are stored as PERCENT: 5.5 means 5.5%. Money fields are decimal strings.
Return JSON only: {name, description, category, severity, field, expected, expression}.
If the sentence cannot be expressed with these fields and operators, return
{"error":"<one sentence naming what is missing>"}.`;

export async function authorRule(sentence: string) {
  const res = await callModel("author", AUTHOR_SYSTEM, sentence, AuthorOut);
  if (res.ok) return { ...res.data, source: res.source, model: res.model };

  // AuthorOut is a union of "a rule" and "an explanation of why not", and a Zod union
  // failure reports only "Invalid input" with no path — useless to a person deciding
  // whether the model misbehaved or the sentence was genuinely unanswerable. Say which.
  const why = /Invalid input/.test(res.reason)
    ? "the model's reply matched neither a rule nor a refusal"
    : res.reason;
  return {
    error: `This instance could not compile that sentence into a rule (${why}). Name the field and the threshold explicitly — for example "flag loans where creditScore is under 600".`,
  };
}
