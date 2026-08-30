import { desc, eq } from "drizzle-orm";
import { db, verifiedRecords, tapes, attestations, users } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { Empty } from "@/components/ui";
import { summary } from "@/lib/service/portfolio";
import Ledger, { LedgerRow } from "./ledger";
import VerifiedSummary from "./summary";

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

  // portfolio-wide, because a consumer's question is about the data they can use, not
  // about whichever tape happened to be uploaded last
  const overview = await summary(null);
  const signOffs = await db.select({
    a: attestations, tapeName: tapes.name, signer: users.email,
  })
    .from(attestations)
    .innerJoin(tapes, eq(tapes.id, attestations.tapeId))
    .leftJoin(users, eq(users.id, attestations.signerId))
    .orderBy(desc(attestations.createdAt)).limit(10);

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

      <VerifiedSummary
        quality={{ ...overview.dataQuality, records: overview.records }}
        sealed={overview.verified.records}
        attestations={overview.verified.attestations}
        exceptions={{ bySeverity: overview.exceptions.bySeverity, openGating: overview.exceptions.openGating }}
        history={signOffs.map((h) => ({
          tapeId: h.a.tapeId, tapeName: h.tapeName,
          signer: h.signer ?? h.a.signerEmail, at: h.a.createdAt.toISOString(),
          records: h.a.recordCount, root: h.a.merkleRoot,
        }))}
      />

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
