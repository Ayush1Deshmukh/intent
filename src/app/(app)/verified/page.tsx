import { desc, eq } from "drizzle-orm";
import { db, verifiedRecords, tapes, attestations } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { Empty } from "@/components/ui";
import Ledger, { LedgerRow } from "./ledger";

export const dynamic = "force-dynamic";

const CAP = 400;

export default async function VerifiedPage() {
  await requireRolePage("verified:read");
  const rows = await db.select({
    v: verifiedRecords, tape: tapes.name, tapeId: tapes.id, root: attestations.merkleRoot,
  })
    .from(verifiedRecords)
    .innerJoin(tapes, eq(tapes.id, verifiedRecords.tapeId))
    .leftJoin(attestations, eq(attestations.tapeId, verifiedRecords.tapeId))
    .orderBy(desc(verifiedRecords.createdAt))
    .limit(CAP + 1);

  const capped = rows.length > CAP;
  const items: LedgerRow[] = rows.slice(0, CAP).map((r) => {
    const p = r.v.payload as Record<string, string | number | null>;
    return {
      id: r.v.id, loanId: r.v.loanId, tape: r.tape, tapeId: r.tapeId,
      balance: p.currentBalance == null ? null : String(p.currentBalance),
      rate: p.interestRate == null ? null : String(p.interestRate),
      status: p.paymentStatus == null ? null : String(p.paymentStatus),
      signedBy: r.v.verifiedByEmail, recordHash: r.v.recordHash,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rise">
        <span className="eyebrow">Zone 3 · immutable ledger</span>
        <h1 className="text-2xl font-semibold">Verified records</h1>
        <p className="text-sm text-ink2 max-w-prose">
          Each row is a sealed artifact: the finalized values, a pointer back to the exact source file
          and row it came from, the rules that fired on the way, who signed it off, and its own hash.
          A downstream system can verify one of these without trusting this database.
        </p>
      </div>

      {items.length === 0 ? (
        <Empty
          title="Nothing has been signed off yet"
          hint="A Reviewer seals a tape once no blocking or critical exception remains open."
        />
      ) : (
        <Ledger rows={items} capped={capped} />
      )}
    </div>
  );
}
