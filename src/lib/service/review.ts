import { and, eq, sql } from "drizzle-orm";
import {
  db, exceptions, loanRecords, proposals, decisions, rules, transformations, rawRecords, sourceFiles, tapes,
} from "@/lib/db";
import { emit } from "@/lib/audit";
import { recordHash } from "@/lib/hash";
import { Session } from "@/lib/auth";
import { HttpProblem } from "@/lib/problem";
import { CanonicalField, FIELD_META } from "@/lib/schema/fields";
import { deterministicRepair, EngineRecord } from "@/lib/rules/engine";
import { loadRuleDefs } from "./ingest";

/** the exception, its rule, its record and the raw row it came from — one query */
export async function loadExceptionContext(exceptionId: string) {
  const [row] = await db.select({
    exc: exceptions, rule: rules, rec: loanRecords, raw: rawRecords, file: sourceFiles,
  })
    .from(exceptions)
    .innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .leftJoin(rawRecords, eq(rawRecords.id, loanRecords.rawRecordId))
    .leftJoin(sourceFiles, eq(sourceFiles.id, rawRecords.sourceFileId))
    .where(eq(exceptions.id, exceptionId))
    .limit(1);
  if (!row) throw new HttpProblem(404, "exception-not-found", "That exception does not exist.");
  return row;
}

export function recordValues(rec: typeof loanRecords.$inferSelect | null) {
  if (!rec) return {};
  const v: Record<string, unknown> = {};
  for (const f of Object.keys(FIELD_META) as CanonicalField[]) {
    const raw = (rec as unknown as Record<string, unknown>)[f];
    v[f] = raw instanceof Date ? raw.toISOString() : raw;
  }
  return v as Partial<Record<CanonicalField, string | number | null>>;
}

/** Deterministic proposal — the fallback that keeps the demo alive with the model unplugged. */
export async function deterministicProposal(exceptionId: string) {
  const ctx = await loadExceptionContext(exceptionId);
  const defs = await loadRuleDefs();
  const def = defs.find((d) => d.code === ctx.rule.code);
  if (!def || !ctx.rec) return null;

  const engineRec: EngineRecord = {
    id: ctx.rec.id, loanId: ctx.rec.loanId,
    values: recordValues(ctx.rec),
    errors: {},
    conflicts: (ctx.exc.detail as EngineRecord["conflicts"]) ?? {},
  };
  const rawByField: Partial<Record<CanonicalField, string>> = {};
  if (ctx.exc.field) rawByField[ctx.exc.field as CanonicalField] = ctx.exc.observed ?? "";
  if (ctx.raw) {
    // find the raw cell behind the flagged field, for the zip/rate repairs
    const orig = ctx.raw.original as Record<string, string>;
    for (const [, value] of Object.entries(orig)) void value;
  }
  return deterministicRepair(def, engineRec, rawByField);
}

export async function createProposal(session: Session, exceptionId: string, input: {
  field: string; toValue: string | null; rationale: string; confidence: number;
  source: "AI" | "RULE" | "HUMAN";
  model?: string | null; promptHash?: string | null; promptText?: string | null;
  responseText?: string | null; tokensIn?: number | null; tokensOut?: number | null;
  latencyMs?: number | null; evidence?: { label: string; value: string }[] | null;
}) {
  const ctx = await loadExceptionContext(exceptionId);
  const from = ctx.rec ? String((recordValues(ctx.rec) as Record<string, unknown>)[input.field] ?? "") : null;

  return db.transaction(async (tx) => {
    const [p] = await tx.insert(proposals).values({
      exceptionId, field: input.field, fromValue: from, toValue: input.toValue,
      rationale: input.rationale, confidence: input.confidence, source: input.source,
      model: input.model ?? null, promptHash: input.promptHash ?? null,
      promptText: input.promptText ?? null, responseText: input.responseText ?? null,
      tokensIn: input.tokensIn ?? null, tokensOut: input.tokensOut ?? null,
      latencyMs: input.latencyMs ?? null, evidence: input.evidence ?? null,
      status: "DRAFT",
    }).returning();

    await emit(tx, {
      tapeId: ctx.exc.tapeId, actorId: session.userId, actorRole: session.role,
      action: "AI_PROPOSAL_CREATED", entityType: "proposal", entityId: p.id,
      payload: {
        exceptionId, field: input.field, from, to: input.toValue,
        source: input.source, confidence: input.confidence,
        model: input.model ?? null, promptHash: input.promptHash ?? null,
      },
    });
    return p;
  });
}

/** The Data Operator accepts. This creates a PENDING CHANGE. The loan is untouched. */
export async function acceptProposal(session: Session, proposalId: string, reason?: string) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!p) throw new HttpProblem(404, "proposal-not-found", "That proposal does not exist.");
  if (p.status !== "DRAFT") throw new HttpProblem(409, "proposal-not-draft", `This proposal is already ${p.status}.`);
  const ctx = await loadExceptionContext(p.exceptionId);

  return db.transaction(async (tx) => {
    await emit(tx, {
      tapeId: ctx.exc.tapeId, actorId: session.userId, actorRole: session.role,
      action: "PROPOSAL_ACCEPTED", entityType: "proposal", entityId: p.id,
      payload: { exceptionId: p.exceptionId, field: p.field, from: p.fromValue, to: p.toValue, reason: reason ?? null },
    });
    await tx.insert(decisions).values({
      proposalId: p.id, actorId: session.userId, actorRole: session.role, action: "accept", reason: reason ?? null,
    });
    await tx.update(proposals).set({ status: "ACCEPTED_BY_OPERATOR", acceptedById: session.userId }).where(eq(proposals.id, p.id));
    await tx.update(exceptions).set({ status: "PENDING_APPROVAL" }).where(eq(exceptions.id, p.exceptionId));
    return { ...p, status: "ACCEPTED_BY_OPERATOR" as const };
  });
}

/**
 * The Reviewer approves. Only here does a loan record change — and the audit event
 * is written BEFORE the mutation, inside the same transaction.
 */
export async function approveProposal(session: Session, proposalId: string, reason?: string) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!p) throw new HttpProblem(404, "proposal-not-found", "That proposal does not exist.");
  if (p.status !== "ACCEPTED_BY_OPERATOR") {
    throw new HttpProblem(409, "proposal-not-pending",
      `Only a change accepted by a Data Operator can be approved; this one is ${p.status}.`);
  }
  if (p.acceptedById === session.userId) {
    throw new HttpProblem(403, "self-approval-forbidden",
      "The person who accepted a change cannot also approve it. That separation is the point of maker-checker.");
  }
  const ctx = await loadExceptionContext(p.exceptionId);
  if (!ctx.rec) throw new HttpProblem(409, "no-record", "This exception is not attached to a loan record.");

  const field = p.field as CanonicalField;
  const meta = FIELD_META[field];
  if (!meta) throw new HttpProblem(400, "unknown-field", `"${field}" is not a canonical field.`);

  const next = { ...recordValues(ctx.rec), [field]: p.toValue } as Record<string, unknown>;
  const nextVersion = ctx.rec.version + 1;
  const nextHash = recordHash({ ...next, id: null, version: nextVersion });

  return db.transaction(async (tx) => {
    await emit(tx, {
      tapeId: ctx.exc.tapeId, actorId: session.userId, actorRole: session.role,
      action: "CHANGE_APPROVED", entityType: "loanRecord", entityId: ctx.rec!.id,
      payload: {
        proposalId: p.id, exceptionId: p.exceptionId, field, from: p.fromValue, to: p.toValue,
        acceptedBy: p.acceptedById, version: nextVersion, recordHash: nextHash, reason: reason ?? null,
      },
    });

    await tx.insert(decisions).values({
      proposalId: p.id, actorId: session.userId, actorRole: session.role, action: "approve", reason: reason ?? null,
    });

    const set: Record<string, unknown> = { version: nextVersion, recordHash: nextHash };
    set[field] = p.toValue === null || p.toValue === ""
      ? null
      : meta.kind === "int" ? Number(p.toValue)
      : meta.kind === "timestamp" ? new Date(p.toValue)
      : p.toValue;

    await tx.update(loanRecords).set(set).where(eq(loanRecords.id, ctx.rec!.id));
    await tx.insert(transformations).values({
      recordId: ctx.rec!.id, field, before: p.fromValue, after: p.toValue, coercion: "review.approved",
    });
    await tx.update(proposals).set({ status: "APPROVED" }).where(eq(proposals.id, p.id));
    await tx.update(exceptions).set({ status: "RESOLVED" }).where(eq(exceptions.id, p.exceptionId));

    return { recordId: ctx.rec!.id, field, from: p.fromValue, to: p.toValue, version: nextVersion };
  });
}

export async function rejectProposal(session: Session, proposalId: string, reason: string) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!p) throw new HttpProblem(404, "proposal-not-found", "That proposal does not exist.");
  const ctx = await loadExceptionContext(p.exceptionId);
  const wasPending = p.status === "ACCEPTED_BY_OPERATOR";

  return db.transaction(async (tx) => {
    await emit(tx, {
      tapeId: ctx.exc.tapeId, actorId: session.userId, actorRole: session.role,
      action: wasPending ? "CHANGE_REJECTED" : "PROPOSAL_REJECTED",
      entityType: "proposal", entityId: p.id,
      payload: { exceptionId: p.exceptionId, field: p.field, to: p.toValue, reason },
    });
    await tx.insert(decisions).values({
      proposalId: p.id, actorId: session.userId, actorRole: session.role, action: "reject", reason,
    });
    await tx.update(proposals).set({ status: "REJECTED" }).where(eq(proposals.id, p.id));
    await tx.update(exceptions).set({ status: "OPEN" }).where(eq(exceptions.id, p.exceptionId));
  });
}

/** Warnings and info can be waived, with a reason. Gating severities cannot. */
export async function waiveException(session: Session, exceptionId: string, reason: string) {
  const ctx = await loadExceptionContext(exceptionId);
  if (ctx.exc.severity === "BLOCKER" || ctx.exc.severity === "CRITICAL") {
    throw new HttpProblem(409, "cannot-waive-gating-exception",
      `A ${ctx.exc.severity.toLowerCase()} exception cannot be waived — it has to be resolved or the tape rejected.`);
  }
  if (!reason || reason.trim().length < 4) {
    throw new HttpProblem(400, "reason-required", "Waiving an exception requires a written reason.");
  }
  return db.transaction(async (tx) => {
    await emit(tx, {
      tapeId: ctx.exc.tapeId, actorId: session.userId, actorRole: session.role,
      action: "EXCEPTION_WAIVED", entityType: "exception", entityId: exceptionId,
      payload: { rule: ctx.rule.code, severity: ctx.exc.severity, reason },
    });
    await tx.update(exceptions).set({ status: "WAIVED" }).where(eq(exceptions.id, exceptionId));
  });
}

export async function tapeCounts(tapeId: string) {
  const rows = await db.select({
    severity: exceptions.severity, status: exceptions.status, n: sql<number>`count(*)::int`,
  }).from(exceptions).where(eq(exceptions.tapeId, tapeId))
    .groupBy(exceptions.severity, exceptions.status);

  const bySeverity: Record<string, number> = { BLOCKER: 0, CRITICAL: 0, WARNING: 0, INFO: 0 };
  const byStatus: Record<string, number> = {};
  let openGating = 0;
  for (const r of rows) {
    bySeverity[r.severity] += r.n;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    if ((r.severity === "BLOCKER" || r.severity === "CRITICAL") &&
        (r.status === "OPEN" || r.status === "PENDING_APPROVAL")) openGating += r.n;
  }
  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  return { bySeverity, byStatus, total, openGating };
}
