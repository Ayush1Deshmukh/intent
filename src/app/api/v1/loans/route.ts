import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { listLoans, resolveTapeId } from "@/lib/service/portfolio";

/** GET /loans — canonical loan records, across tapes or within one. */
export const GET = problemHandler(async (req) => {
  await requireRole("tape:read");
  const url = new URL(req.url);
  const tapeId = url.searchParams.get("tapeId");
  return Response.json(await listLoans({
    tapeId: tapeId === "all" ? null : await resolveTapeId(tapeId),
    status: url.searchParams.getAll("status"),
    q: url.searchParams.get("q"),
    limit: Math.min(Number(url.searchParams.get("limit") ?? 50), 200),
    cursor: url.searchParams.get("cursor"),
  }));
});
