import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { waiveException } from "@/lib/service/review";

export const POST = problemHandler(async (req, ctx: unknown) => {
  const session = await requireRole("exception:waive");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  await waiveException(session, id, String(body.reason ?? ""));
  return Response.json({ ok: true });
});
