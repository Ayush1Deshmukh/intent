"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, and } from "drizzle-orm";
import { db, fieldMappings, tapes, rules } from "@/lib/db";
import { getSession, requireRole, signIn, signOut, Session } from "@/lib/auth";
import { HttpProblem } from "@/lib/problem";
import { ingestFiles, normalizeAndValidate } from "@/lib/service/ingest";
import { acceptProposal, approveProposal, createProposal, rejectProposal, waiveException } from "@/lib/service/review";
import { attestTape } from "@/lib/service/attest";
import { proposeFix, authorRule } from "@/lib/ai/jobs";
import { emit } from "@/lib/audit";

const err = (e: unknown) => (e instanceof HttpProblem ? e.detail : e instanceof Error ? e.message : "Something went wrong.");

export async function loginAction(_prev: unknown, form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  try { await signIn(email, password); } catch (e) { return { error: err(e) }; }
  redirect("/tapes");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

/** Loads the demo fixtures from disk — the one-click path a judge will actually use. */
export async function loadDemoTapeAction() {
  const session = await requireRole("tape:upload");
  const root = process.cwd();
  const read = async (n: string) => ({ filename: n, buffer: await readFile(join(root, "fixtures", n)) });
  const res = await ingestFiles(session, `Q3 2026 acquisition tape`, [
    { kind: "LOAN_TAPE", ...(await read("loan_tape.csv")) },
    { kind: "SERVICER_UPDATE", ...(await read("servicer_update.csv")) },
    { kind: "DOCUMENT_MANIFEST", ...(await read("document_manifest.csv")) },
  ], Number(process.env.MAX_TAPE_ROWS ?? 5000));
  redirect(`/tapes/${res.tapeId}/mapping`);
}

export async function uploadAction(_prev: unknown, form: FormData) {
  let tapeId: string;
  try {
    const session = await requireRole("tape:upload");
    const kinds = ["LOAN_TAPE", "SERVICER_UPDATE", "DOCUMENT_MANIFEST"] as const;
    const files: { kind: (typeof kinds)[number]; filename: string; buffer: Buffer }[] = [];
    for (const k of kinds) {
      const f = form.get(k) as File | null;
      if (f && f.size > 0) files.push({ kind: k, filename: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
    }
    if (files.length === 0) return { error: "Choose at least a loan tape to upload." };
    const name = String(form.get("name") || files[0].filename);
    const res = await ingestFiles(session, name, files, Number(process.env.MAX_TAPE_ROWS ?? 5000));
    tapeId = res.tapeId;
  } catch (e) { return { error: err(e) }; }
  redirect(`/tapes/${tapeId}/mapping`);
}

export async function confirmMappingAction(_prev: unknown, form: FormData) {
  const tapeId = String(form.get("tapeId"));
  try {
    const session = await requireRole("tape:map");
    const rows = await db.select().from(fieldMappings)
      .where(and(eq(fieldMappings.tapeId, tapeId), eq(fieldMappings.sourceKind, "LOAN_TAPE")));
    for (const row of rows) {
      const chosen = form.get(`map:${row.sourceHeader}`);
      const value = chosen === null || chosen === "" ? null : String(chosen);
      const changed = value !== row.canonicalField;
      await db.update(fieldMappings).set({
        canonicalField: value,
        method: changed ? "MANUAL" : row.method,
        confidence: changed ? 1 : row.confidence,
        confirmedById: session.userId,
        confirmedAt: new Date(),
      }).where(eq(fieldMappings.id, row.id));
    }
    await normalizeAndValidate(session, tapeId, String(form.get("asOf") || "2026-07-31"));
  } catch (e) { return { error: err(e) }; }
  redirect(`/tapes/${tapeId}`);
}

export async function proposeAction(exceptionId: string) {
  const session = await requireRole("proposal:request");
  const s = await proposeFix(exceptionId);
  if (!s) return { error: "No defensible correction could be derived for this exception. It needs a person." };
  await createProposal(session, exceptionId, {
    field: s.field, toValue: s.toValue, rationale: s.rationale, confidence: s.confidence,
    source: s.source, model: s.model, promptHash: s.promptHash ?? null,
    promptText: "promptText" in s ? (s.promptText as string | null) : null,
    responseText: "responseText" in s ? (s.responseText as string | null) : null,
    tokensIn: "tokensIn" in s ? (s.tokensIn as number | null) : null,
    tokensOut: "tokensOut" in s ? (s.tokensOut as number | null) : null,
    latencyMs: "latencyMs" in s ? (s.latencyMs as number | null) : null,
    evidence: s.evidence ?? null,
  });
  revalidatePath("/tapes", "layout");
  return { ok: true };
}

export async function acceptAction(proposalId: string, reason?: string) {
  const session = await requireRole("proposal:accept");
  try { await acceptProposal(session, proposalId, reason); } catch (e) { return { error: err(e) }; }
  revalidatePath("/tapes", "layout"); revalidatePath("/review");
  return { ok: true };
}

export async function approveAction(proposalId: string, reason?: string) {
  const session = await requireRole("proposal:approve");
  try { await approveProposal(session, proposalId, reason); } catch (e) { return { error: err(e) }; }
  revalidatePath("/tapes", "layout"); revalidatePath("/review");
  return { ok: true };
}

export async function rejectAction(proposalId: string, reason: string) {
  const session = await getSession();
  if (!session) return { error: "Sign in to continue." };
  try { await rejectProposal(session, proposalId, reason); } catch (e) { return { error: err(e) }; }
  revalidatePath("/tapes", "layout"); revalidatePath("/review");
  return { ok: true };
}

export async function waiveAction(exceptionId: string, reason: string) {
  const session = await requireRole("exception:waive");
  try { await waiveException(session, exceptionId, reason); } catch (e) { return { error: err(e) }; }
  revalidatePath("/tapes", "layout");
  return { ok: true };
}

export async function attestAction(tapeId: string) {
  const session = await requireRole("tape:attest");
  try { await attestTape(session, tapeId); } catch (e) { return { error: err(e) }; }
  revalidatePath("/tapes", "layout");
  return { ok: true };
}

export async function draftRuleAction(_prev: unknown, form: FormData) {
  const sentence = String(form.get("sentence") ?? "").trim();
  if (!sentence) return { error: "Describe the rule you want in a sentence." };
  const session = await requireRole("rule:draft");
  const out = await authorRule(sentence);
  if ("error" in out) return { error: out.error, sentence };
  return { draft: out, sentence, by: session.email };
}
