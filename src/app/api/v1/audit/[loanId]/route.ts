import { requireRole } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { loanAudit } from "@/lib/service/portfolio";

/** GET /audit/:loanId — every audit event that touches one loan, in chain order. */
export const GET = problemHandler(async (req, ctx: unknown) => {
  await requireRole("audit:read");
  const { params } = ctx as unknown as { params: Promise<{ loanId: string }> };
  const { loanId } = await params;
  const tapeId = new URL(req.url).searchParams.get("tapeId");

  const result = await loanAudit(loanId, tapeId);
  if (!result) throw new HttpProblem(404, "loan-not-found", `No loan record for ${loanId}.`);
  return Response.json(result);
});
