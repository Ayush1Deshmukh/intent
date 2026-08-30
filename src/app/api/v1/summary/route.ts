import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { summary } from "@/lib/service/portfolio";

/** GET /summary — counts, data-quality score and verification state. */
export const GET = problemHandler(async (req) => {
  await requireRole("tape:read");
  const tapeId = new URL(req.url).searchParams.get("tapeId");
  return Response.json(await summary(tapeId === "all" ? null : tapeId));
});
