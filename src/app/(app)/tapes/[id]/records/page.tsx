import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, loanRecords } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import RecordGrid from "./grid";

export const dynamic = "force-dynamic";

export default async function RecordsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRolePage("tape:read");
  const { id } = await params;
  const rows = await db.select().from(loanRecords).where(eq(loanRecords.tapeId, id))
    .orderBy(asc(loanRecords.loanId)).limit(600);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href={`/tapes/${id}`} className="eyebrow no-underline">← Tape</Link>
        <h1 className="text-2xl font-semibold">Canonical records</h1>
        <p className="text-sm text-ink2">Click any row to see its full lineage — raw value, coercion, rules, proposals, decisions, hash.</p>
      </div>
      <RecordGrid rows={rows.map((r) => ({
        id: r.id, loanId: r.loanId, borrowerId: r.borrowerId,
        originationDate: r.originationDate, maturityDate: r.maturityDate,
        originalPrincipal: r.originalPrincipal, currentBalance: r.currentBalance,
        interestRate: r.interestRate, termMonths: r.termMonths,
        paymentStatus: r.paymentStatus, daysPastDue: r.daysPastDue,
        borrowerState: r.borrowerState, creditScore: r.creditScore,
        documentStatus: r.documentStatus, status: r.verificationStatus,
        version: r.version, recordHash: r.recordHash,
      }))} />
    </div>
  );
}
