import { and, desc, eq } from "drizzle-orm";
import { db, verifiedRecords, attestations } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { loanProof } from "@/lib/service/attest";
import { resolveTapeId } from "@/lib/service/portfolio";

/**
 * GET /verified-loans/:id — the proof is public; the record is not.
 *
 * Anyone gets the record hash, its Merkle path and the signed root: exactly what
 * someone already holding a record needs to check it, and nothing about any borrower.
 * The sealed record itself needs `verified:read`. Same contract as
 * /api/v1/verified/{tapeId}?loanId=…, which this is the loan-first spelling of.
 */
export const GET = problemHandler(async (req, ctx: unknown) => {
  const { params } = ctx as unknown as { params: Promise<{ loanId: string }> };
  const { loanId } = await params;
  const raw = new URL(req.url).searchParams.get("tapeId");
  const tapeId = await resolveTapeId(raw);
  if (!tapeId) throw new HttpProblem(404, "no-tapes", "Nothing has been ingested yet.");

  const [rec] = await db.select().from(verifiedRecords)
    .where(and(eq(verifiedRecords.tapeId, tapeId), eq(verifiedRecords.loanId, loanId)))
    .orderBy(desc(verifiedRecords.createdAt)).limit(1);
  if (!rec) {
    throw new HttpProblem(404, "loan-not-verified",
      `${loanId} is not in the verified ledger for this tape.`);
  }

  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, tapeId)).limit(1);
  const session = await getSession();
  const mayReadRecords = !!session && can(session.role, "verified:read");

  return Response.json({
    loanId: rec.loanId,
    tapeId,
    recordHash: rec.recordHash,
    merkleRoot: att?.merkleRoot ?? null,
    verifiedByEmail: rec.verifiedByEmail,
    proof: await loanProof(tapeId, loanId),
    ...(mayReadRecords ? { record: rec } : {
      note: "Sign in as a Data Consumer to receive the sealed record itself. " +
            "The hash, the proof and the root above verify a record you already hold.",
    }),
  });
});
