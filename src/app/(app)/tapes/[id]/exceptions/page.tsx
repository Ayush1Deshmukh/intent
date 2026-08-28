import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, exceptions, rules, loanRecords, rawRecords } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { tapeCounts } from "@/lib/service/review";
import { clusterExceptions } from "@/lib/ai/jobs";
import { SeverityBar } from "@/components/ui";
import Queue from "./queue";

export const dynamic = "force-dynamic";

export default async function ExceptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = (await getSession())!;
  const { id } = await params;

  const rows = await db.select({ exc: exceptions, rule: rules, loanId: loanRecords.loanId, rowNumber: rawRecords.rowNumber })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .leftJoin(rawRecords, eq(rawRecords.id, loanRecords.rawRecordId))
    .where(eq(exceptions.tapeId, id))
    .orderBy(asc(exceptions.severity), asc(exceptions.id));

  const counts = await tapeCounts(id);
  const clusters = await clusterExceptions(id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href={`/tapes/${id}`} className="eyebrow no-underline">← Tape</Link>
        <h1 className="text-2xl font-semibold">Exception queue</h1>
      </div>

      <div className="card p-4"><SeverityBar counts={counts.bySeverity} /></div>

      <Queue
        tapeId={id}
        canAct={can(session.role, "proposal:accept")}
        canWaive={can(session.role, "exception:waive")}
        clusters={clusters.map((c) => ({ key: c.key, label: c.label, rootCause: c.rootCause,
          count: c.exceptionIds.length, suggestedAction: c.suggestedAction, source: c.source, confidence: c.confidence }))}
        rows={rows.map((r) => ({
          id: r.exc.id, loanId: r.loanId, rowNumber: r.rowNumber, field: r.exc.field, observed: r.exc.observed,
          expected: r.exc.expected, severity: r.exc.severity, status: r.exc.status,
          clusterKey: r.exc.clusterKey, ruleCode: r.rule.code, ruleName: r.rule.name,
          ruleDescription: r.rule.description, category: r.rule.category,
        }))}
      />
    </div>
  );
}
