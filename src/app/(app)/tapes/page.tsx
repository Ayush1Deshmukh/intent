import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, tapes, exceptions, loanRecords, attestations, users } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { Chip, Empty } from "@/components/ui";
import DemoButton from "./demo-button";

export const dynamic = "force-dynamic";

export default async function TapesPage() {
  const session = (await getSession())!;
  const rows = await db.select({
    t: tapes,
    uploader: users.name,
    records: sql<number>`(select count(*)::int from loan_records lr where lr.tape_id = ${tapes.id})`,
    excs: sql<number>`(select count(*)::int from exceptions e where e.tape_id = ${tapes.id})`,
    open: sql<number>`(select count(*)::int from exceptions e where e.tape_id = ${tapes.id} and e.status in ('OPEN','PENDING_APPROVAL') and e.severity in ('BLOCKER','CRITICAL'))`,
    root: attestations.merkleRoot,
  }).from(tapes)
    .leftJoin(users, eq(users.id, tapes.uploadedById))
    .leftJoin(attestations, eq(attestations.tapeId, tapes.id))
    .orderBy(desc(tapes.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Batches</span>
          <h1 className="text-2xl font-semibold">Loan tapes</h1>
        </div>
        {can(session.role, "tape:upload") ? (
          <div className="flex gap-2">
            <DemoButton />
            <Link href="/tapes/new" className="btn btn-primary no-underline">Upload a tape</Link>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Empty title="No tapes yet"
          hint={can(session.role, "tape:upload")
            ? "Load the demo tape to see the whole flow: 500 rows, three sources, and a set of planted defects."
            : "A Data Operator needs to upload a tape before there is anything to review."} />
      ) : (
        <div className="card overflow-hidden">
          <table className="grid">
            <thead>
              <tr><th>Tape</th><th>Status</th><th className="tnum">Rows</th><th className="tnum">Exceptions</th>
                  <th className="tnum">Gating open</th><th>Merkle root</th><th>Uploaded by</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t.id}>
                  <td><Link href={`/tapes/${r.t.id}`} className="font-medium">{r.t.name}</Link></td>
                  <td><Chip tone={r.t.status === "VERIFIED" ? "ok" : r.t.status === "MAPPING" ? "brass" : "accent"}>{r.t.status.replace("_", " ")}</Chip></td>
                  <td className="tnum">{r.records}</td>
                  <td className="tnum">{r.excs}</td>
                  <td className="tnum">{r.open > 0 ? <span className="text-crit font-medium">{r.open}</span> : <span className="text-muted">0</span>}</td>
                  <td>{r.root ? <span className="mono text-xs text-muted">{r.root.slice(0, 16)}…</span> : <span className="text-muted text-xs">not signed off</span>}</td>
                  <td className="text-muted">{r.uploader ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
