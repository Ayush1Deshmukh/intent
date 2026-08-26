import { eq } from "drizzle-orm";
import { db, loanRecords } from "@/lib/db";
import { computeStats, EngineRecord } from "@/lib/rules/engine";
import { evaluate, Expr } from "@/lib/rules/dsl";
import { US_STATES } from "@/lib/coerce/state";
import { recordValues } from "./review";

/**
 * Run a candidate rule against a real tape and report what it WOULD flag —
 * before anything is saved. A rule nobody previewed is a rule nobody trusts.
 */
export async function previewRule(tapeId: string, expression: Expr) {
  const recs = await db.select().from(loanRecords).where(eq(loanRecords.tapeId, tapeId));
  const engine: EngineRecord[] = recs.map((r) => ({
    id: r.id, loanId: r.loanId, values: recordValues(r), errors: {}, conflicts: {},
  }));
  const stats = computeStats(engine);
  const refs = { usStates: new Set(Object.keys(US_STATES)), servicers: new Set<string>() };

  const hits: { loanId: string | null; recordId: string }[] = [];
  let errors = 0;
  for (const rec of engine) {
    try {
      if (evaluate(expression, { record: rec.values, errors: {}, conflicts: {}, stats, refs, asOf: new Date().toISOString().slice(0, 10) })) {
        hits.push({ loanId: rec.loanId, recordId: rec.id });
      }
    } catch { errors++; }
  }
  return {
    scanned: engine.length,
    wouldFlag: hits.length,
    sampleLoanIds: hits.slice(0, 8).map((h) => h.loanId).filter(Boolean),
    evaluationErrors: errors,
  };
}
