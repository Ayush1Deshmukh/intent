import Link from "next/link";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, tapes, exceptions, rules, loanRecords, attestations, sourceFiles, auditEvents, rawRecords } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { tapeCounts } from "@/lib/service/review";
import { Chip, SeverityBar, Stat } from "@/components/ui";
import IntegrityPanel from "./integrity";
import Zones from "./zones";
import AttestButton from "./attest-button";

export const dynamic = "force-dynamic";

export default async function TapePage({ params }: { params: Promise<{ id: string }> }) {
  const session = (await getSession())!;
  const { id } = await params;
  const [tape] = await db.select().from(tapes).where(eq(tapes.id, id)).limit(1);
  if (!tape) return <p>That tape does not exist.</p>;

  const counts = await tapeCounts(id);
  const [{ records }] = await db.select({ records: sql<number>`count(*)::int` })
    .from(loanRecords).where(eq(loanRecords.tapeId, id));
  const [{ affected }] = await db.select({ affected: sql<number>`count(distinct ${exceptions.recordId})::int` })
    .from(exceptions).where(eq(exceptions.tapeId, id));
  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, id)).limit(1);
  const files = await db.select().from(sourceFiles).where(eq(sourceFiles.tapeId, id));
  const [{ events }] = await db.select({ events: sql<number>`count(*)::int` })
    .from(auditEvents).where(eq(auditEvents.tapeId, id));

  const topRules = await db.select({
    code: rules.code, name: rules.name, severity: rules.severity,
    n: sql<number>`count(*)::int`,
  }).from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .where(eq(exceptions.tapeId, id))
    .groupBy(rules.code, rules.name, rules.severity)
    .orderBy(desc(sql`count(*)`)).limit(6);

  const [{ unreadable }] = await db.select({ unreadable: sql<number>`count(*)::int` })
    .from(rawRecords).innerJoin(sourceFiles, eq(sourceFiles.id, rawRecords.sourceFileId))
    .where(and(eq(sourceFiles.tapeId, id), isNotNull(rawRecords.parseError)));

  const [{ excludedCount }] = await db.select({ excludedCount: sql<number>`count(*)::int` })
    .from(loanRecords).where(and(eq(loanRecords.tapeId, id), eq(loanRecords.verificationStatus, "REJECTED")));

  const clean = records - affected;
  const pct = records ? ((clean / records) * 100).toFixed(1) : "0";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap rise">
        <div className="flex flex-col gap-1">
          <Link href="/tapes" className="eyebrow no-underline">← Tapes</Link>
          <h1 className="text-2xl font-semibold">{tape.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Chip tone={tape.status === "VERIFIED" ? "ok" : "accent"}>{tape.status.replace(/_/g, " ")}</Chip>
            <span className="text-xs text-muted">{files.length} source files · {events} audit events</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={`/tapes/${id}/exceptions`} className="btn no-underline">Exception queue</Link>
          <Link href={`/tapes/${id}/records`} className="btn no-underline">Records</Link>
          <Link href={`/tapes/${id}/audit`} className="btn no-underline">Audit chain</Link>
          {can(session.role, "tape:attest") ? <AttestButton tapeId={id} disabled={counts.openGating > 0} openGating={counts.openGating} /> : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger">
        <Stat label="Rows" count={records} sub={`${files.reduce((a, f) => a + f.rowCount, 0)} rows across all sources`} />
        <Stat label="Exceptions" count={counts.total} sub={`${affected} rows affected`} />
        <Stat label="Clean rows" count={Number(pct)} decimals={1} suffix="%" sub={`${clean} of ${records} carry no exception`} />
        <Stat label="Gating open" count={counts.openGating}
          tone={counts.openGating > 0 ? "var(--color-crit)" : "var(--color-ok)"}
          sub={counts.openGating > 0 ? "sign-off is blocked" : "eligible for sign-off"} />
      </div>

      <Zones
        files={files.map((f) => ({ kind: f.kind, filename: f.filename, sha256: f.sha256, rowCount: f.rowCount }))}
        rows={records} exceptions={counts.total} cleanRows={clean}
        sealed={att?.recordCount ?? 0} excluded={excludedCount} unreadable={unreadable}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:items-start stagger">
        <section className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Severity</h2>
            <Link href={`/tapes/${id}/exceptions`} className="text-xs">open the queue →</Link>
          </div>
          <SeverityBar counts={counts.bySeverity} />
          <div>
            <h3 className="eyebrow mb-2">Rules failing most</h3>
            <table className="dtable">
              <tbody>
                {topRules.map((r) => (
                  <tr key={r.code}>
                    <td className="mono text-xs w-20">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="w-24"><span className={`chip sev-${r.severity}`}>{r.severity.toLowerCase()}</span></td>
                    <td className="tnum text-right w-14 font-medium">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <IntegrityPanel tapeId={id} attested={!!att} merkleRoot={att?.merkleRoot ?? null}
          recordCount={att?.recordCount ?? 0} signer={att?.signerEmail ?? null} />
      </div>

    </div>
  );
}
