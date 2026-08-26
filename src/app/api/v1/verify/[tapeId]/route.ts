import { verifyTape } from "@/lib/service/attest";
import { problemHandler } from "@/lib/problem";

/**
 * PUBLIC and unauthenticated on purpose: anyone can check a tape, nobody can
 * change it. That asymmetry is the property an auditor actually wants.
 */
export const GET = problemHandler(async (_req, ctx: unknown) => {
  const { params } = ctx as unknown as { params: Promise<{ tapeId: string }> };
  const { tapeId } = await params;
  const result = await verifyTape(tapeId);
  return Response.json(result, { status: result.ok ? 200 : 409, headers: { "cache-control": "no-store" } });
});
