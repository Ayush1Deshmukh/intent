import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { clusterExceptions } from "@/lib/ai/jobs";

export const POST = problemHandler(async (_req, ctx: unknown) => {
  await requireRole("tape:read");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  return Response.json({ clusters: await clusterExceptions(id) });
});
