import { requireRole } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { getLoan } from "@/lib/service/portfolio";

/** GET /loans/:id — one loan with its exceptions, proposals, source row and seal. */
export const GET = problemHandler(async (req, ctx: unknown) => {
  await requireRole("tape:read");
  const { params } = ctx as unknown as { params: Promise<{ loanId: string }> };
  const { loanId } = await params;
  const tapeId = new URL(req.url).searchParams.get("tapeId");

  const loan = await getLoan(loanId, tapeId);
  if (!loan) throw new HttpProblem(404, "loan-not-found", `No loan record for ${loanId}.`);
  return Response.json(loan);
});
