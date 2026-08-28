/**
 * The demo's last thirty seconds.
 *
 * Edits a verified loan DIRECTLY IN THE DATABASE, bypassing the application
 * entirely — no API call, no audit event, no approval. Exactly the fraud a
 * write-only audit log cannot see.
 *
 *   npx tsx --env-file=.env scripts/tamper.ts LN-000117 --balance 1
 *   npx tsx --env-file=.env scripts/tamper.ts --event 5
 *   npx tsx --env-file=.env scripts/tamper.ts --restore
 *
 * Then press "Check integrity" in the browser.
 */
import { eq, sql } from "drizzle-orm";
import { db, loanRecords, verifiedRecords } from "@/lib/db";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? "");
};

async function main() {
  if (args.includes("--restore")) {
    // put every tampered value back from the sealed payload, so the demo can be re-run
    const rows = await db.select({ v: verifiedRecords }).from(verifiedRecords);
    let n = 0;
    for (const { v } of rows) {
      const p = v.payload as Record<string, string | null>;
      await db.update(loanRecords)
        .set({ currentBalance: p.currentBalance, interestRate: p.interestRate, recordHash: v.recordHash })
        .where(eq(loanRecords.id, v.loanRecordId));
      n++;
    }
    // and undo an edited audit event: the flag was added to the payload, so removing
    // it restores the exact bytes the stored hash was computed over
    const events = await db.execute(sql`
      UPDATE audit_events SET payload = payload - 'tampered'
      WHERE payload ? 'tampered' RETURNING seq`);
    console.log(`restored ${n} records from their sealed payloads`);
    if (events.rowCount) console.log(`un-edited ${events.rowCount} audit event(s) — the chain should verify again`);
    process.exit(0);
  }

  const eventSeq = flag("event");
  if (eventSeq !== null) {
    const seq = Number(eventSeq || 5);
    await db.execute(sql`UPDATE audit_events SET payload = payload || '{"tampered":true}'::jsonb WHERE seq = ${seq}`);
    console.log(`edited audit event #${seq} in place — the chain check should now name it as the first bad link`);
    process.exit(0);
  }

  const loanId = args.find((a) => !a.startsWith("--")) ?? null;
  const balance = flag("balance") ?? "1";
  const rate = flag("rate");

  const target = loanId
    ? await db.select({ v: verifiedRecords }).from(verifiedRecords)
        .where(eq(verifiedRecords.loanId, loanId)).limit(1)
    : await db.select({ v: verifiedRecords }).from(verifiedRecords).limit(1);

  if (!target.length) {
    console.error(loanId
      ? `${loanId} is not in the verified ledger. Sign a tape off first, then tamper with it.`
      : "Nothing has been signed off yet. Sign a tape off first, then tamper with it.");
    process.exit(1);
  }

  const { v } = target[0];
  const before = await db.select().from(loanRecords).where(eq(loanRecords.id, v.loanRecordId)).limit(1);

  if (rate !== null) {
    await db.execute(sql`UPDATE loan_records SET interest_rate = ${rate} WHERE id = ${v.loanRecordId}`);
  } else {
    await db.execute(sql`UPDATE loan_records SET current_balance = ${balance} WHERE id = ${v.loanRecordId}`);
  }

  console.log(`tampered with ${v.loanId} directly in SQL`);
  console.log(`  before: currentBalance ${before[0].currentBalance}, interestRate ${before[0].interestRate}`);
  console.log(`  after : ${rate !== null ? `interestRate ${rate}` : `currentBalance ${balance}`}`);
  console.log(`  no audit event was written, because the application was never involved.`);
  console.log(`\nNow press "Check integrity" — or:`);
  console.log(`  curl -s localhost:3000/api/v1/verify/${v.tapeId} | head -40`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
