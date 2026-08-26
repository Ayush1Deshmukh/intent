import { requireSession } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { acceptProposal, approveProposal, rejectProposal } from "@/lib/service/review";
import { can } from "@/lib/policy";

export const POST = problemHandler(async (req, ctx: unknown) => {
  const session = await requireSession();
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "accept") {
    if (!can(session.role, "proposal:accept")) throw new HttpProblem(403, "role-not-permitted", `Your role cannot accept proposals.`);
    return Response.json(await acceptProposal(session, id, body.reason));
  }
  if (action === "approve") {
    if (!can(session.role, "proposal:approve")) throw new HttpProblem(403, "role-not-permitted", `Your role cannot approve changes.`);
    return Response.json(await approveProposal(session, id, body.reason));
  }
  if (action === "reject") {
    if (!body.reason) throw new HttpProblem(400, "reason-required", "Rejecting a change requires a reason.");
    await rejectProposal(session, id, String(body.reason));
    return Response.json({ ok: true });
  }
  throw new HttpProblem(400, "unknown-action", `"${action}" is not one of accept, approve or reject.`);
});
