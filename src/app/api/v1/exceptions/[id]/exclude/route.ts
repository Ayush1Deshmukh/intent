import { requireRole } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { excludeLoan, loadExceptionContext } from "@/lib/service/review";

/**
 * Drop the loan behind this exception from the tape.
 *
 * The escape hatch for a blocking exception that has no defensible repair — the
 * reviewer excludes the loan rather than inventing a value for it. Reviewer only,
 * always with a written reason, and it lands in the attestation.
 */
export const POST = problemHandler(async (req, ctx: unknown) => {
  const session = await requireRole("loan:exclude");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const exc = await loadExceptionContext(id);
  if (!exc.rec) {
    throw new HttpProblem(409, "not-a-loan-exception",
      "This is a tape-level finding, not a loan. There is no loan to exclude.");
  }
  const result = await excludeLoan(session, exc.rec.id, String(body.reason ?? ""));
  return Response.json({ ok: true, ...result });
});
