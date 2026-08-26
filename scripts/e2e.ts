/**
 * End-to-end acceptance run against a real database, with no browser.
 * ingest -> map -> validate -> propose -> accept -> approve -> attest -> verify
 *        -> tamper directly in SQL -> verify fails and names the loan
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, tapes, exceptions, rules, loanRecords, users, auditEvents, verifiedRecords, proposals } from "@/lib/db";
import { ingestFiles, normalizeAndValidate } from "@/lib/service/ingest";
import { acceptProposal, approveProposal, createProposal, tapeCounts, waiveException } from "@/lib/service/review";
import { attestTape, verifyTape, loanProof } from "@/lib/service/attest";
import { proposeFix, clusterExceptions } from "@/lib/ai/jobs";
import { seedReference } from "./seed";
import type { Session } from "@/lib/auth";

const ROOT = join(import.meta.dirname ?? process.cwd(), "..");
const fx = (n: string) => ({ filename: n, buffer: readFileSync(join(ROOT, "fixtures", n)) });
let failures = 0;
const check = (b: boolean, msg: string) => { if (!b) failures++; console.log(`  ${b ? "PASS" : "FAIL"}  ${msg}`); };

async function main() {
  console.log("\n--- reset ---");
  await db.execute(sql`TRUNCATE tapes, users, rules, servicer_refs, audit_events, ai_cache, idempotency_keys, chain_lock RESTART IDENTITY CASCADE`);
  await seedReference();

  const all = await db.select().from(users);
  const operator = all.find((u) => u.role === "DATA_OPERATOR")!;
  const reviewer = all.find((u) => u.role === "REVIEWER")!;
  const opSession: Session = { userId: operator.id, email: operator.email, name: operator.name, role: "DATA_OPERATOR" };
  const revSession: Session = { userId: reviewer.id, email: reviewer.email, name: reviewer.name, role: "REVIEWER" };

  console.log("\n--- 1. ingest three sources ---");
  const ing = await ingestFiles(opSession, "Q3 2026 acquisition tape", [
    { kind: "LOAN_TAPE", ...fx("loan_tape.csv") },
    { kind: "SERVICER_UPDATE", ...fx("servicer_update.csv") },
    { kind: "DOCUMENT_MANIFEST", ...fx("document_manifest.csv") },
  ], 5000);
  console.log(`  tape ${ing.tapeId}  rows ${ing.rowCount}  sha ${ing.sha256.slice(0, 12)}...`);
  const auto = ing.matches.filter((m) => m.canonicalField).length;
  check(ing.rowCount === 500, `500 rows landed in the raw quarantine zone`);
  check(auto === 18, `${auto} of ${ing.matches.length} headers mapped automatically`);

  console.log("\n--- 2. confirm mapping, normalize, validate ---");
  const res = await normalizeAndValidate(opSession, ing.tapeId, "2026-07-31");
  console.log(`  records ${res.records}  exceptions ${res.exceptions}  conflicts ${res.conflicts}  clean ${res.cleanRecords}`);
  console.log(`  column formats`, JSON.stringify(res.hints));
  check(res.records === 500, "500 canonical records written to the working zone");
  check(res.exceptions === 209, `209 exceptions raised (got ${res.exceptions})`);
  check(res.suppressed === 11, `${res.suppressed} dependent rules suppressed because their input was already flagged`);
  check(res.unmapped.length === 1, `1 unmapped column flagged: ${res.unmapped.join(",")}`);

  const counts = await tapeCounts(ing.tapeId);
  console.log(`  severity`, counts.bySeverity, `gating open ${counts.openGating}`);

  console.log("\n--- 3. the AI cluster job (fallback path, model disabled) ---");
  const clusters = await clusterExceptions(ing.tapeId);
  const top = clusters[0];
  console.log(`  ${clusters.length} clusters; largest: "${top.label}" x${top.exceptionIds.length} (${top.source})`);
  check(top.exceptionIds.length === 45, `largest cluster holds 45 exceptions (got ${top.exceptionIds.length})`);

  console.log("\n--- 4. attestation is blocked while gating exceptions are open ---");
  let blocked = false;
  try { await attestTape(revSession, ing.tapeId); } catch (e) { blocked = true; console.log(`  ${(e as Error).message}`); }
  check(blocked, "sign-off refused while gating exceptions are open");

  console.log("\n--- 5. propose -> accept -> approve on one exception ---");
  const [amort] = await db.select({ exc: exceptions, rule: rules, rec: loanRecords })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .innerJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .where(and(eq(exceptions.tapeId, ing.tapeId), eq(rules.code, "XFD-003"))).limit(1);
  console.log(`  ${amort.rec.loanId}  ${amort.rule.code}  observed ${amort.exc.observed}`);

  const suggestion = await proposeFix(amort.exc.id);
  console.log(`  proposal: ${suggestion!.field} ${suggestion!.toValue}  confidence ${suggestion!.confidence}  source ${suggestion!.source}`);
  check(!!suggestion && suggestion.source === "RULE", "deterministic repair produced a proposal with the model disabled");

  const prop = await createProposal(opSession, amort.exc.id, {
    field: suggestion!.field, toValue: suggestion!.toValue, rationale: suggestion!.rationale,
    confidence: suggestion!.confidence, source: suggestion!.source, model: suggestion!.model,
    promptHash: suggestion!.promptHash, evidence: suggestion!.evidence,
  });

  const beforeHash = amort.rec.recordHash;
  await acceptProposal(opSession, prop.id, "matches the amortization schedule");
  const [afterAccept] = await db.select().from(loanRecords).where(eq(loanRecords.id, amort.rec.id));
  check(afterAccept.recordHash === beforeHash, "accepting a proposal does NOT change the loan record");
  const [excAfterAccept] = await db.select().from(exceptions).where(eq(exceptions.id, amort.exc.id));
  check(excAfterAccept.status === "PENDING_APPROVAL", "the exception moved to PENDING_APPROVAL");

  let selfBlocked = false;
  try { await approveProposal(opSession, prop.id); } catch (e) { selfBlocked = true; console.log(`  ${(e as Error).message}`); }
  check(selfBlocked, "the operator cannot approve their own change");

  const applied = await approveProposal(revSession, prop.id, "verified against the note");
  const [afterApprove] = await db.select().from(loanRecords).where(eq(loanRecords.id, amort.rec.id));
  console.log(`  applied ${applied.field}: ${applied.from} -> ${applied.to}  v${applied.version}`);
  check(afterApprove.recordHash !== beforeHash, "approving DOES change the record and its hash");
  check(afterApprove.version === 2, "the record version was bumped");

  console.log("\n--- 6. clear the remaining gating exceptions the fast way ---");
  // a demo shortcut, not a product feature: reject the rest so we can reach sign-off
  await db.update(exceptions).set({ status: "REJECTED" })
    .where(and(eq(exceptions.tapeId, ing.tapeId), inArray(exceptions.severity, ["BLOCKER", "CRITICAL"]),
               inArray(exceptions.status, ["OPEN", "PENDING_APPROVAL"])));
  const after = await tapeCounts(ing.tapeId);
  check(after.openGating === 0, "no gating exceptions remain open");

  console.log("\n--- 7. attest ---");
  const att = await attestTape(revSession, ing.tapeId);
  console.log(`  merkle root ${att.merkleRoot}`);
  console.log(`  ${att.recordCount} loans sealed into the verified ledger, signed by ${att.signerEmail}`);
  check(att.recordCount > 400, `${att.recordCount} verified records written to zone 3`);

  console.log("\n--- 8. verify ---");
  const v1 = await verifyTape(ing.tapeId);
  console.log(`  chain ${v1.chain.ok ? "intact" : "BROKEN"} over ${v1.chain.eventsChecked} events`);
  console.log(`  data  ${v1.data.ok ? "matches the attestation" : "DIVERGES"}`);
  check(v1.ok, "verification passes immediately after sign-off");

  const sample = await db.select().from(verifiedRecords).where(eq(verifiedRecords.tapeId, ing.tapeId)).limit(1);
  const proof = await loanProof(ing.tapeId, sample[0].loanId);
  check(proof.valid, `merkle proof for ${proof.loanId} verifies against the root offline`);

  console.log("\n--- 9. TAMPER: edit a verified balance directly in SQL ---");
  const victim = sample[0];
  await db.execute(sql`UPDATE loan_records SET current_balance = '1.00' WHERE id = ${victim.loanRecordId}`);
  const v2 = await verifyTape(ing.tapeId);
  console.log(`  chain ${v2.chain.ok ? "intact" : "BROKEN"}   data ${v2.data.ok ? "matches" : "DIVERGES"}`);
  if (v2.data.divergences[0]) {
    const d = v2.data.divergences[0];
    console.log(`  ${d.loanId}: ${d.reason}`);
    console.log(`    attested   ${d.attestedHash.slice(0, 32)}...`);
    console.log(`    recomputed ${d.recomputedHash.slice(0, 32)}...`);
  }
  check(!v2.ok, "verification now FAILS");
  check(v2.chain.ok, "the audit chain is still intact — an audit log alone would have missed this");
  check(v2.data.divergences[0]?.loanId === victim.loanId, `the divergent loan is named: ${victim.loanId}`);

  console.log("\n--- 10. TAMPER: edit an audit event in place ---");
  await db.execute(sql`UPDATE audit_events SET payload = '{"tampered":true}'::jsonb WHERE seq = 5`);
  const v3 = await verifyTape(ing.tapeId);
  console.log(`  chain ${v3.chain.ok ? "intact" : "BROKEN"} — ${v3.chain.reason ?? ""}`);
  check(!v3.chain.ok && v3.chain.firstBadSeq === 5, "the chain check names event 5 as the first bad link");

  const eventCount = await db.select({ n: sql<number>`count(*)::int` }).from(auditEvents);
  console.log(`\n--- audit chain: ${eventCount[0].n} events ---`);

  console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
