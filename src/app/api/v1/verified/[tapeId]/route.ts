import { and, eq } from "drizzle-orm";
import { db, verifiedRecords } from "@/lib/db";
import { problemHandler, HttpProblem } from "@/lib/problem";
import { loanProof } from "@/lib/service/attest";

/**
 * Public. A downstream system can pull a sealed record together with its Merkle
 * proof and check it offline, without trusting this database or this API.
 */
export const GET = problemHandler(async (req, ctx: unknown) => {
  const { params } = ctx as unknown as { params: Promise<{ tapeId: string }> };
  const { tapeId } = await params;
  const loanId = new URL(req.url).searchParams.get("loanId");

  if (!loanId) {
    const rows = await db.select().from(verifiedRecords)
      .where(eq(verifiedRecords.tapeId, tapeId)).limit(500);
    return Response.json({ items: rows });
  }

  const [rec] = await db.select().from(verifiedRecords)
    .where(and(eq(verifiedRecords.tapeId, tapeId), eq(verifiedRecords.loanId, loanId)))
    .limit(1);
  if (!rec) {
    throw new HttpProblem(404, "loan-not-verified",
      `${loanId} is not in the verified ledger for this tape.`);
  }
  return Response.json({ record: rec, proof: await loanProof(tapeId, loanId) });
});
