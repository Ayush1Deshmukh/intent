import { requireRole } from "@/lib/auth";
import { problemHandler, HttpProblem } from "@/lib/problem";
import { proposeFix } from "@/lib/ai/jobs";
import { createProposal } from "@/lib/service/review";

export const POST = problemHandler(async (req, ctx: unknown) => {
  const session = await requireRole("proposal:request");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.mode === "manual") {
    if (!body.field || body.toValue === undefined) {
      throw new HttpProblem(400, "invalid-proposal", "A manual proposal needs a field and a value.");
    }
    const p = await createProposal(session, id, {
      field: body.field, toValue: body.toValue === "" ? null : String(body.toValue),
      rationale: String(body.rationale ?? "entered by hand"), confidence: 1, source: "HUMAN",
    });
    return Response.json(p, { status: 201 });
  }

  const s = await proposeFix(id);
  if (!s) {
    throw new HttpProblem(422, "no-defensible-correction",
      "No correction could be derived for this exception. It needs a person to decide.");
  }
  const p = await createProposal(session, id, {
    field: s.field, toValue: s.toValue, rationale: s.rationale, confidence: s.confidence,
    source: s.source, model: s.model, promptHash: s.promptHash ?? null,
    promptText: "promptText" in s ? (s.promptText as string | null) : null,
    responseText: "responseText" in s ? (s.responseText as string | null) : null,
    tokensIn: "tokensIn" in s ? (s.tokensIn as number | null) : null,
    tokensOut: "tokensOut" in s ? (s.tokensOut as number | null) : null,
    latencyMs: "latencyMs" in s ? (s.latencyMs as number | null) : null,
    evidence: s.evidence ?? null,
  });
  return Response.json(p, { status: 201 });
});
