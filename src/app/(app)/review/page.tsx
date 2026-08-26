import { desc, eq, inArray } from "drizzle-orm";

import { db, proposals, exceptions, rules, loanRecords, users, tapes } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { Empty } from "@/components/ui";
import ReviewList from "./list";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireRolePage("proposal:approve");

  const rows = await db.select({
    p: proposals, exc: exceptions, rule: rules,
    loanId: loanRecords.loanId, recordId: loanRecords.id,
    tapeName: tapes.name, tapeId: tapes.id, acceptedBy: users.name, acceptedEmail: users.email,
  })
    .from(proposals)
    .innerJoin(exceptions, eq(exceptions.id, proposals.exceptionId))
    .innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .innerJoin(tapes, eq(tapes.id, exceptions.tapeId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .leftJoin(users, eq(users.id, proposals.acceptedById))
    .where(inArray(proposals.status, ["ACCEPTED_BY_OPERATOR"]))
    .orderBy(desc(proposals.createdAt));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
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
          evidence: r.p.evidence, loanId: r.loanId, tapeName: r.tapeName, tapeId: r.tapeId,
          ruleCode: r.rule.code, ruleName: r.rule.name, severity: r.exc.severity,
          acceptedBy: r.acceptedBy ?? "—", acceptedEmail: r.acceptedEmail ?? "",
        }))} />
      )}
    </div>
  );
}
