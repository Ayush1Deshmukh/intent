import { asc, desc, eq, sql } from "drizzle-orm";
import { db, rules, exceptions, tapes } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { describeExpr } from "@/lib/rules/dsl";
import { CATEGORY_LABEL } from "@/lib/rules/catalog";
import RuleAuthor from "./author";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const session = (await getSession())!;
  const rows = await db.select().from(rules).orderBy(asc(rules.code));
  const hits = await db.select({ ruleId: exceptions.ruleId, n: sql<number>`count(*)::int` })
    .from(exceptions).groupBy(exceptions.ruleId);
  const hitBy = new Map(hits.map((h) => [h.ruleId, h.n]));
  const [latestTape] = await db.select({ id: tapes.id, name: tapes.name })
    .from(tapes).orderBy(desc(tapes.createdAt)).limit(1);

  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Validation</span>
        <h1 className="text-2xl font-semibold">Rule library</h1>
        <p className="text-sm text-ink2 max-w-prose">
          {rows.length} rules across {byCategory.size} families. Every rule is stored as data, not code:
          its expression describes the violation and evaluates true when a row is bad. That is what lets
          the library grow without a redeploy — and what lets a sentence become a rule.
        </p>
      </div>

      {can(session.role, "rule:draft") && latestTape
        ? <RuleAuthor tapeId={latestTape.id} tapeName={latestTape.name} />
        : null}

      {[...byCategory.entries()].map(([cat, list]) => (
        <section key={cat} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{CATEGORY_LABEL[cat] ?? cat}</h2>
          <div className="card overflow-hidden">
            <table className="grid">
              <thead>
                <tr><th>Code</th><th>Rule</th><th>Severity</th><th>Expression</th><th className="tnum">Fired</th><th>State</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="mono text-xs">{r.code}</td>
                    <td className="max-w-md">
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-muted leading-snug mt-0.5">{r.description}</span>
                    </td>
                    <td><span className={`chip sev-${r.severity}`}>{r.severity.toLowerCase()}</span></td>
                    <td className="mono text-[0.68rem] text-ink2 max-w-xs break-words">{describeExpr(r.expression as never)}</td>
                    <td className="tnum">{hitBy.get(r.id) ?? 0}</td>
                    <td>
                      <span className={`chip ${r.enabled ? "bg-oksoft text-ok" : "bg-warnsoft text-warn"}`}>
                        {r.enabled ? "enabled" : "awaiting approval"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
