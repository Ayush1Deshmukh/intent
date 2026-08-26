import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, verifiedRecords, tapes, attestations } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function VerifiedPage() {
  await requireRolePage("verified:read");
  const rows = await db.select({
    v: verifiedRecords, tape: tapes.name, tapeId: tapes.id, root: attestations.merkleRoot,
  })
    .from(verifiedRecords)
    .innerJoin(tapes, eq(tapes.id, verifiedRecords.tapeId))
    .leftJoin(attestations, eq(attestations.tapeId, verifiedRecords.tapeId))
    .orderBy(desc(verifiedRecords.createdAt))
    .limit(400);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Zone 3 · immutable ledger</span>
        <h1 className="text-2xl font-semibold">Verified records</h1>
        <p className="text-sm text-ink2 max-w-prose">
          Each row is a sealed artifact: the finalized values, a pointer back to the exact source file
          and row it came from, the rules that fired on the way, who signed it off, and its own hash.
          A downstream system can verify one of these without trusting this database.
        </p>
      </div>

      {rows.length === 0 ? (
        <Empty
          title="Nothing has been signed off yet"
          hint="A Reviewer seals a tape once no blocking or critical exception remains open."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="grid">
            <thead>
              <tr><th>Loan</th><th>Tape</th><th>Balance</th><th>Rate</th><th>Status</th><th>Signed by</th><th>Record hash</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.v.payload as Record<string, string | number | null>;
                return (
                  <tr key={r.v.id}>
                    <td className="mono text-xs font-medium">{r.v.loanId}</td>
                    <td className="text-xs"><Link href={`/tapes/${r.tapeId}`}>{r.tape}</Link></td>
                    <td className="tnum mono text-xs text-right">{p.currentBalance ?? "—"}</td>
                    <td className="tnum mono text-xs text-right">{p.interestRate ?? "—"}</td>
                    <td className="text-xs">{p.paymentStatus ?? "—"}</td>
                    <td className="text-xs text-muted">{r.v.verifiedByEmail}</td>
                    <td className="mono text-[0.62rem] text-muted" title={r.v.recordHash}>{r.v.recordHash.slice(0, 14)}…</td>
                    <td>
                      <a className="text-xs" href={`/api/v1/verified/${r.tapeId}?loanId=${r.v.loanId}`} target="_blank" rel="noreferrer">proof</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
