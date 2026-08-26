import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { attestTape } from "@/lib/service/attest";

export const POST = problemHandler(async (_req, ctx: unknown) => {
  const session = await requireRole("tape:attest");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  return Response.json(await attestTape(session, id), { status: 201 });
});
