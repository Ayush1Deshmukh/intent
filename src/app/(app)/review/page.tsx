import { desc, eq, inArray } from "drizzle-orm";

import { db, proposals, exceptions, rules, loanRecords, rawRecords, users, tapes, decisions } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { Empty } from "@/components/ui";
import ReviewList from "./list";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireRolePage("proposal:approve");

  const rows = await db.select({
    p: proposals, exc: exceptions, rule: rules,
    loanId: loanRecords.loanId, recordId: loanRecords.id, rowNumber: rawRecords.rowNumber,
    tapeName: tapes.name, tapeId: tapes.id, acceptedBy: users.name, acceptedEmail: users.email,
  })
    .from(proposals)
    .innerJoin(exceptions, eq(exceptions.id, proposals.exceptionId))
    .innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .innerJoin(tapes, eq(tapes.id, exceptions.tapeId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .leftJoin(rawRecords, eq(rawRecords.id, loanRecords.rawRecordId))
    .leftJoin(users, eq(users.id, proposals.acceptedById))
    .where(inArray(proposals.status, ["ACCEPTED_BY_OPERATOR"]))
    .orderBy(desc(proposals.createdAt));

  /**
   * What the reviewer already did, under what they have left to do.
   *
   * Not decoration: the queue above is a list of open questions, and a reviewer coming
   * back to it needs to know where they left off — and, more usefully, be able to see
   * their own recent judgements next to the ones they are about to make.
   */
  const recent = await db.select({
    d: decisions, actor: users.email, rule: rules.code,
    loanId: loanRecords.loanId, field: proposals.field,
    from: proposals.fromValue, to: proposals.toValue, source: proposals.source,
  })
    .from(decisions)
    .innerJoin(proposals, eq(proposals.id, decisions.proposalId))
    .innerJoin(exceptions, eq(exceptions.id, proposals.exceptionId))
    .innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .leftJoin(users, eq(users.id, decisions.actorId))
    .orderBy(desc(decisions.createdAt)).limit(12);

  const ACTION_TONE: Record<string, string> = {
    approve: "bg-oksoft text-ok", accept: "bg-brasssoft text-brass", reject: "bg-critsoft text-crit",
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rise">
        <span className="eyebrow">Maker-checker</span>
        <h1 className="text-2xl font-semibold">Pending changes</h1>
        <p className="text-sm text-ink2 max-w-prose">
          Every row here is a change a Data Operator accepted but nobody has applied.
          Approving one is the only action in this system that alters a loan record — and it writes
          the audit event before the change, in the same transaction.
        </p>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nothing waiting for approval"
          hint="When a Data Operator accepts a proposed correction, it lands here as a before-and-after diff." />
      ) : (
        <ReviewList items={rows.map((r) => ({
          id: r.p.id, field: r.p.field, from: r.p.fromValue, to: r.p.toValue,
          rationale: r.p.rationale, confidence: r.p.confidence, source: r.p.source, model: r.p.model,
          evidence: r.p.evidence, loanId: r.loanId, rowNumber: r.rowNumber, tapeName: r.tapeName, tapeId: r.tapeId,
          ruleCode: r.rule.code, ruleName: r.rule.name, severity: r.exc.severity,
          acceptedBy: r.acceptedBy ?? "—", acceptedEmail: r.acceptedEmail ?? "",
        }))} />
      )}

      <section className="card p-5 flex flex-col gap-3 rise">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold">Recent decisions</h2>
          <span className="text-[0.7rem] text-muted">
            every accept, approve and reject — the reviewer&rsquo;s own action history
          </span>
        </div>

        {recent.length === 0 ? (
          <p className="text-sm text-muted">No decisions yet on any tape.</p>
        ) : (
          <table className="dtable">
            <thead>
              <tr><th>Action</th><th>Loan</th><th>Rule</th><th>Change</th><th>By</th><th>Reason</th><th>When</th></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.d.id}>
                  <td><span className={`chip ${ACTION_TONE[r.d.action] ?? "bg-surface2 text-muted"}`}>{r.d.action}</span></td>
                  <td className="mono text-xs">{r.loanId ?? <span className="text-muted">tape-level</span>}</td>
                  <td className="mono text-[0.68rem] text-muted">{r.rule}</td>
                  <td className="text-xs">
                    <span className="mono text-muted">{r.field}</span>{" "}
                    <span className="mono">{r.from ?? "empty"} → {r.to ?? "empty"}</span>
                  </td>
                  <td className="text-xs text-muted">{r.actor ?? "—"}</td>
                  <td className="text-xs text-ink2 max-w-[260px]">{r.d.reason || <span className="text-muted">—</span>}</td>
                  <td className="text-xs text-muted whitespace-nowrap">{new Date(r.d.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
