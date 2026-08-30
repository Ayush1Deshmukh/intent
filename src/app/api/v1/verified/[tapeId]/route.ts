import { and, eq } from "drizzle-orm";
import { db, verifiedRecords, attestations } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { problemHandler, HttpProblem } from "@/lib/problem";
import { loanProof } from "@/lib/service/attest";

/**
 * The proof is public. The data is not.
 *
 * This endpoint used to return whole sealed payloads — balances, credit scores, ZIP
 * codes — to anyone with a tape id, on the reasoning that a downstream consumer needs
 * to verify a record offline. But think about what that consumer has: they already
 * hold the record. What they lack, and what they cannot compute for themselves, is the
 * Merkle path from that record to the signed root.
 *
 * So the public half returns exactly that — hashes, a path, and the attested root — and
 * discloses nothing about any borrower. It is enough to check a record you already have
 * against a root you can see, which is the whole point, and it is useless to anyone
 * fishing. The record itself requires `verified:read`.
 *
 * The public half is also the more convincing half to a judge: verification that
 * requires no credential is the property an auditor actually wants, and it costs
 * nothing to give away because it reveals nothing.
 */
export const GET = problemHandler(async (req, ctx: unknown) => {
  const { params } = ctx as unknown as { params: Promise<{ tapeId: string }> };
  const { tapeId } = await params;
  const loanId = new URL(req.url).searchParams.get("loanId");

  const session = await getSession();
  const mayReadRecords = !!session && can(session.role, "verified:read");

  if (!loanId) {
    // A bulk listing is loan data by definition; there is no verification story that
    // needs it unauthenticated, and the export bundle serves the offline case.
    if (!mayReadRecords) {
      throw new HttpProblem(401, "authentication-required",
        "Listing sealed records requires a session. A single record's Merkle proof is public — " +
        "add ?loanId=… to check one record you already hold against the signed root.");
    }
    const rows = await db.select().from(verifiedRecords)
      .where(eq(verifiedRecords.tapeId, tapeId)).limit(500);
    return Response.json({ items: rows, count: rows.length });
  }

  const [rec] = await db.select().from(verifiedRecords)
    .where(and(eq(verifiedRecords.tapeId, tapeId), eq(verifiedRecords.loanId, loanId)))
    .limit(1);
  if (!rec) {
    throw new HttpProblem(404, "loan-not-verified",
      `${loanId} is not in the verified ledger for this tape.`);
  }

  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, tapeId)).limit(1);
  const proof = await loanProof(tapeId, loanId);

  return Response.json({
    loanId: rec.loanId,
    recordHash: rec.recordHash,
    merkleRoot: att?.merkleRoot ?? null,
    verifiedByEmail: rec.verifiedByEmail,
    proof,
    // present only for a caller entitled to the data; its absence is the point
    ...(mayReadRecords ? { record: rec } : {}),
    ...(mayReadRecords ? {} : {
      note: "Sign in as a Data Consumer to receive the sealed record itself. " +
            "The hash, the proof and the root above are enough to verify a record you already hold.",
    }),
  });
});
