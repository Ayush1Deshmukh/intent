import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { loanLineage } from "@/lib/service/attest";

export const GET = problemHandler(async (_req, ctx: unknown) => {
  await requireRole("tape:read");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  return Response.json(await loanLineage(id));
});
