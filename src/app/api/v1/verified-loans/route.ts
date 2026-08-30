import { eq } from "drizzle-orm";
import { db, verifiedRecords } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/policy";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { resolveTapeId } from "@/lib/service/portfolio";

/**
 * GET /verified-loans — the sealed ledger.
 *
 * Same rule as everywhere else in this API: a listing is loan data, so it needs a
 * session. The public half of verification is the per-loan proof, next door.
 */
export const GET = problemHandler(async (req) => {
  const session = await getSession();
  if (!session || !can(session.role, "verified:read")) {
    throw new HttpProblem(401, "authentication-required",
      "Listing sealed records requires a session. A single loan's Merkle proof is public at " +
      "/api/v1/verified-loans/{loanId}.");
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("tapeId");
  const tapeId = raw === "all" ? null : await resolveTapeId(raw);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

  const rows = await db.select().from(verifiedRecords)
    .where(tapeId ? eq(verifiedRecords.tapeId, tapeId) : undefined)
    .limit(limit);

  return Response.json({ items: rows, count: rows.length, tapeId });
});
