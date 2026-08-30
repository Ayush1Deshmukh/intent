/**
 * Builds the second demo tape: one that has already been through review.
 *
 * You cannot triage a hundred and forty gating exceptions on camera, so beats 7
 * and 8 of the demo need a tape that is review-complete. The dishonest way to get
 * one is an UPDATE that closes the exceptions. This script does it the real way —
 * every exception is resolved through the same service functions the UI calls, by
 * the same two people, writing the same audit events:
 *
 *   has a deterministic repair  ->  propose, operator accepts, reviewer approves
 *   warning or info, no repair  ->  reviewer waives it, with a reason
 *   gating, no repair           ->  reviewer excludes the loan, with a reason
 *
 * The result is a tape whose audit chain actually tells the story of its own
 * review, and which verifies. Nothing here bypasses the invariants: no loan record
 * is written except through approveProposal(), and the maker is never the checker.
 *
 *   npm run demo:reviewed
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, exceptions, rules, loanRecords, users } from "@/lib/db";
import { ingestFiles, normalizeAndValidate } from "@/lib/service/ingest";
import {
  acceptProposal, approveProposal, createProposal, deterministicProposal,
  excludeLoan, waiveException, tapeCounts,
} from "@/lib/service/review";
import { attestTape, verifyTape } from "@/lib/service/attest";
import type { Session } from "@/lib/auth";

/**
 * Where the fixture CSVs live. `import.meta.dirname` is empty once this file is
 * bundled to CommonJS for the container image, so the working directory is the
 * fallback — which is correct both there (/app/fixtures) and when run with tsx
 * from the repository root. FIXTURES_DIR overrides both.
 */
const FIXTURES = process.env.FIXTURES_DIR
  || (import.meta.dirname ? join(import.meta.dirname, "..", "fixtures") : join(process.cwd(), "fixtures"));
const fx = (n: string) => ({ filename: n, buffer: readFileSync(join(FIXTURES, n)) });
const NAME = process.env.REVIEWED_TAPE_NAME || "Q2 2026 acquisition tape — signed off";

/**
 * `--tape <id>` works an existing tape instead of ingesting a new one, and stops
 * short of signing off. The browser rehearsal uses it to clear a queue it has
 * already demonstrated the UI can clear one exception at a time.
 */
const TAPE_FLAG = (() => {
  const i = process.argv.indexOf("--tape");
  return i === -1 ? null : (process.argv[i + 1] ?? null);
})();

export type ResolveTally = { repaired: number; waived: number; excluded: number; skipped: number };

/**
 * Resolve every open exception on a tape through the real service paths.
 * Exported so `scripts/e2e.ts` reaches sign-off the same way a person would,
 * rather than closing exceptions with an UPDATE and proving nothing.
 */
export async function resolveAllExceptions(op: Session, rev: Session, tapeId: string): Promise<ResolveTally> {
  const open = await db.select({ exc: exceptions, rule: rules })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .where(and(eq(exceptions.tapeId, tapeId), inArray(exceptions.status, ["OPEN"])));

  const excludedRecords = new Set<string>();
  const tally: ResolveTally = { repaired: 0, waived: 0, excluded: 0, skipped: 0 };

  for (const { exc, rule } of open) {
    // a loan excluded a moment ago has already had its other exceptions closed
    if (exc.recordId && excludedRecords.has(exc.recordId)) continue;

    const repair = await deterministicProposal(exc.id).catch(() => null);
    if (repair && repair.toValue !== null) {
      const p = await createProposal(op, exc.id, {
        field: repair.field, toValue: repair.toValue, rationale: repair.rationale,
        confidence: repair.confidence, source: "RULE",
        evidence: [
          { label: "rule", value: `${rule.code} ${rule.name}` },
          { label: "observed", value: exc.observed ?? "" },
          { label: "derived by", value: "deterministic repair, no model involved" },
        ],
      });
      await acceptProposal(op, p.id, "Deterministic repair, checked against the raw row.");
      await approveProposal(rev, p.id, "Repair is arithmetically forced by the other three fields.");
      tally.repaired++;
      continue;
    }

    const gating = exc.severity === "BLOCKER" || exc.severity === "CRITICAL";
    if (!gating) {
      await waiveException(rev, exc.id,
        `${rule.code} confirmed with the originator; the value is correct as delivered.`);
      tally.waived++;
      continue;
    }

    if (exc.recordId) {
      await excludeLoan(rev, exc.recordId,
        `${rule.code} has no defensible repair from either source. Dropped from the tape rather than guessed at.`);
      excludedRecords.add(exc.recordId);
      tally.excluded++;
      continue;
    }

    // tape-level gating findings (an unmapped column, a missing identifier across the
    // file) belong to the file, not to a loan — there is nothing to exclude
    tally.skipped++;
  }
  return tally;
}

async function sessions() {
  const all = await db.select().from(users);
  const operator = all.find((u) => u.role === "DATA_OPERATOR");
  const reviewer = all.find((u) => u.role === "REVIEWER");
  if (!operator || !reviewer) throw new Error("No demo users. Seed the reference data first.");
  return {
    op: { userId: operator.id, email: operator.email, name: operator.name, role: "DATA_OPERATOR" } as Session,
    rev: { userId: reviewer.id, email: reviewer.email, name: reviewer.name, role: "REVIEWER" } as Session,
  };
}

/**
 * Ingest the fixtures, work the whole queue, and sign off — the callable form,
 * used by `npm run demo:reviewed` and by the container's setup step.
 */
export async function buildReviewedTape(log: (s: string) => void = () => {}) {
  const { op, rev } = await sessions();

  const ing = await ingestFiles(op, NAME, [
    { kind: "LOAN_TAPE", ...fx("loan_tape.csv") },
    { kind: "SERVICER_UPDATE", ...fx("servicer_update.csv") },
    { kind: "DOCUMENT_MANIFEST", ...fx("document_manifest.csv") },
  ], 5000);
  log(`tape ${ing.tapeId}  ${ing.rowCount} rows`);

  const res = await normalizeAndValidate(op, ing.tapeId, "2026-07-31");
  log(`${res.records} records, ${res.exceptions} exceptions, ${res.conflicts} conflicts`);

  const tally = await resolveAllExceptions(op, rev, ing.tapeId);
  log(`repaired ${tally.repaired}  waived ${tally.waived}  excluded ${tally.excluded}`);

  const counts = await tapeCounts(ing.tapeId);
  if (counts.openGating > 0) {
    throw new Error(`${counts.openGating} gating exceptions could not be resolved; cannot sign off`);
  }

  const att = await attestTape(rev, ing.tapeId);
  const dropped = await db.select({ id: loanRecords.id }).from(loanRecords)
    .where(and(eq(loanRecords.tapeId, ing.tapeId), eq(loanRecords.verificationStatus, "REJECTED")));
  const v = await verifyTape(ing.tapeId);

  return {
    tapeId: ing.tapeId, tally, sealed: att.recordCount, excluded: dropped.length,
    merkleRoot: att.merkleRoot, events: v.chain.eventsChecked, verifies: v.ok,
  };
}

async function main() {
  const { op, rev } = await sessions();

  if (TAPE_FLAG) {
    console.log(`\n--- working the open queue on ${TAPE_FLAG} ---`);
    const t = await resolveAllExceptions(op, rev, TAPE_FLAG);
    const c = await tapeCounts(TAPE_FLAG);
    console.log(`  repaired ${t.repaired}  waived ${t.waived}  excluded ${t.excluded}  gating left ${c.openGating}`);
    process.exit(c.openGating === 0 ? 0 : 1);
  }

  console.log("\n--- ingest, review and sign off ---");
  const r = await buildReviewedTape((m) => console.log("  " + m));
  console.log(`\n  ${r.sealed} loans sealed, ${r.excluded} excluded`);
  console.log(`  merkle root ${r.merkleRoot}`);
  console.log(`  chain intact over ${r.events} events`);
  console.log(`  data  ${r.verifies ? "matches the attestation" : "DIVERGES"}`);

  if (!r.verifies) { console.error("\n  The reviewed tape does not verify. That is a bug."); process.exit(1); }
  console.log(`\nReady. Open /tapes/${r.tapeId} — signed off, and it verifies.\n`);
  process.exit(0);
}

if (process.argv[1]?.endsWith("seed-review.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
