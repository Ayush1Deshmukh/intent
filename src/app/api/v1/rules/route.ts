import { asc, eq } from "drizzle-orm";
import { db, rules } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { authorRule } from "@/lib/ai/jobs";
import { Expr } from "@/lib/rules/dsl";
import { emit } from "@/lib/audit";
import { previewRule } from "@/lib/service/preview";

export const GET = problemHandler(async () => {
  await requireRole("tape:read");
  return Response.json({ items: await db.select().from(rules).orderBy(asc(rules.code)) });
});

/**
 * Create a rule, either from a sentence or from DSL directly. Either way the rule
 * is PREVIEWED against a real tape before anything is saved, and saved disabled
 * until a Reviewer approves it.
 */
export const POST = problemHandler(async (req) => {
  const session = await requireRole("rule:draft");
  const body = await req.json().catch(() => ({}));

  let draft = body.rule;
  if (!draft && body.naturalLanguage) {
    const out = await authorRule(String(body.naturalLanguage));
    if ("error" in out) throw new HttpProblem(422, "could-not-compile-rule", out.error ?? "That sentence could not be expressed as a rule.");
    draft = out;
  }
  if (!draft?.expression) throw new HttpProblem(400, "missing-rule", "Provide `rule` or `naturalLanguage`.");

  const preview = body.tapeId ? await previewRule(body.tapeId, draft.expression as Expr) : null;

  if (body.previewOnly) return Response.json({ rule: draft, preview });

  const code = String(body.code ?? `USR-${Date.now().toString(36).toUpperCase().slice(-4)}`);
  const [saved] = await db.insert(rules).values({
    code, name: draft.name, description: draft.description, category: draft.category,
    severity: draft.severity, scope: "record", field: draft.field ?? null,
    expected: draft.expected ?? "", expression: draft.expression, enabled: false,
    createdById: session.userId,
  }).returning();

  await db.transaction(async (tx) => {
    await emit(tx, {
      actorId: session.userId, actorRole: session.role, action: "RULE_CREATED",
      entityType: "rule", entityId: saved.id,
      payload: { code, from: body.naturalLanguage ?? "dsl", expression: draft.expression, preview },
    });
  });

  return Response.json({ rule: saved, preview }, { status: 201 });
});
