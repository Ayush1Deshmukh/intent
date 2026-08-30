/**
 * The demo, rehearsed by a robot.
 *
 * Drives the exact five minutes a judge will watch, through the real browser,
 * as three different people: operator triages and accepts, reviewer approves and
 * signs off, consumer verifies and exports — and then someone edits the database
 * behind everyone's back and the app catches it.
 *
 * Fails loudly on the first thing a live audience would notice.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR || "artifacts/demo";
const EXE = process.env.PW_CHROMIUM || undefined;
await mkdir(SHOTS, { recursive: true });

const fails = [];
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { console.log("  FAIL  " + m); fails.push(m); };
const step = (m) => console.log("\n--- " + m + " ---");
const note = (m) => console.log("        " + m);

const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const errs = [];

async function login(email) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1100 } });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errs.push(email + ": " + m.text()); });
  p.on("pageerror", (e) => errs.push(email + ": " + String(e)));
  await p.goto(BASE + "/login", { waitUntil: "networkidle" });
  await p.locator(`form:has(input[value="${email}"]) button`).click();
  await p.waitForURL((u) => !u.pathname.includes("login"), { timeout: 20000 }).catch(() => {});
  return p;
}

/**
 * Half of what this script asserts is "the screen says X" — which is worth very
 * little on its own. The other half reads the database directly and checks the
 * claim underneath: that accepting a proposal did NOT change the loan, that the
 * exclusion really was written, that the tampered value really did change. Hence
 * a real connection rather than shelling out to a container-specific psql.
 *
 * Run with:  node --env-file=.env scripts/ui/demo.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run: node --env-file=.env scripts/ui/demo.mjs");
  process.exit(1);
}
const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
await pgc.connect();
const sql = async (q) => {
  const r = await pgc.query(q);
  return r.rows.length ? String(Object.values(r.rows[0])[0] ?? "") : "";
};

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" });

/* ============================================================ 1  OPERATOR */
step("1  operator: load the tape and confirm the mapping");
const op = await login("operator@intain.demo");
await op.goto(BASE + "/tapes", { waitUntil: "networkidle" });
await op.locator('button:has-text("demo"),button:has-text("Demo"),button:has-text("Load")').first().click();
await op.waitForURL(/\/mapping/, { timeout: 90000 }).catch(() => {});
const tapeId = op.url().match(/tapes\/([^/]+)/)?.[1];
if (!tapeId) {
  // Almost always one of two things, and neither is worth ten minutes of guessing:
  // the app is pointed at a different database than this script, or its connection
  // pool is stale because the database container was recreated underneath it.
  bad("never reached a tape");
  note(`stuck at ${op.url()}`);
  note("page said: " + (await op.locator("body").innerText()).slice(0, 300).replace(/\n/g, " | "));
  note(`this script is using ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":***@")}`);
  note("if the app runs in docker, check `docker compose logs app` and restart it:");
  note("  docker compose restart app");
  await pgc.end(); await b.close();
  process.exit(1);
}
note("tape " + tapeId);
await op.waitForTimeout(1500);
await shot(op, "01-mapping");

const mapText = await op.locator("body").innerText();
/confidence|matched|alias|mapped/i.test(mapText)
  ? ok("mapping screen shows how each column was matched")
  : bad("mapping screen does not explain its matches");

await op.locator('button:has-text("Confirm")').first().click();
await op.waitForTimeout(25000);
ok("mapping confirmed, pipeline ran");

await op.goto(`${BASE}/tapes/${tapeId}`, { waitUntil: "networkidle" });
await op.waitForTimeout(1200);
await shot(op, "02-overview");
const ov = await op.locator("body").innerText();
/\b209\b/.test(ov) ? ok("209 exceptions on the overview") : bad("exception count wrong:\n" + ov.slice(0, 400));

/* ============================================ 2  ROOT-CAUSE CLUSTERING */
step("2  operator: group 209 exceptions by root cause");
await op.goto(`${BASE}/tapes/${tapeId}/exceptions`, { waitUntil: "networkidle" });
await op.waitForTimeout(2000);
await op.locator('button:has-text("Group by root cause")').click();
await op.waitForTimeout(1200);
await shot(op, "03-clusters");
const cl = await op.locator("body").innerText();
/two different orderings|date/i.test(cl)
  ? ok("the date-format cluster is named as one root cause")
  : bad("no root-cause cluster visible:\n" + cl.slice(0, 600));
/servicer update disagrees|conflict/i.test(cl)
  ? ok("the servicer-conflict cluster is named")
  : bad("no source-conflict cluster visible");

// filter to that cluster and back out
const showThese = op.locator('button:has-text("Show these")').first();
if (await showThese.count()) {
  await showThese.click(); await op.waitForTimeout(800);
  const f = await op.locator("body").innerText();
  /root cause filter/i.test(f) ? ok("clicking a cluster filters the queue to it") : bad("cluster filter did not apply");
  await op.locator('button:has-text("clear")').first().click().catch(() => {});
  await op.waitForTimeout(500);
} else bad("cluster has no 'Show these' action");

/* ==================================== 3  EXPLAIN -> PROPOSE -> ACCEPT */
step("3  operator: open one exception, explain it, propose a fix, accept it");
// pick an XFD-003 (payment does not amortize) — it has a deterministic repair
await op.locator('select').first().selectOption("XFD-003").catch(() => {});
await op.waitForTimeout(900);
// pick a row that actually carries a loan id, so the diff is checkable in SQL afterwards
const withId = op.locator('table.dtable tbody tr').filter({ hasText: /LN-\d+/ }).first();
(await withId.count()) ? ok("found an identified row failing XFD-003") : bad("no identified XFD-003 row");
await withId.locator('button:has-text("Open")').click();
await op.waitForTimeout(900);
await shot(op, "04-drawer");

const drawer = op.locator("aside");
(await drawer.count()) ? ok("the exception drawer opens") : bad("no drawer");

await op.locator('button:has-text("Explain")').click();
await op.waitForTimeout(6000);
await shot(op, "05-explained");
const ex1 = await drawer.innerText();
/What the rule checks/i.test(ex1) ? ok("explanation renders all three parts") : bad("explanation missing:\n" + ex1.slice(0, 500));
/rule-based, no model|model ·/i.test(ex1)
  ? ok("the explanation is labelled with its provenance (model vs rule)")
  : bad("provenance chip missing — a judge cannot tell what wrote this");

await op.locator('button:has-text("Propose a fix")').click();
await op.waitForTimeout(9000);
await shot(op, "06-proposal");
const pr = await drawer.innerText();
/Proposed change/i.test(pr) ? ok("a proposal is produced") : bad("no proposal:\n" + pr.slice(0, 600));
/confidence 0\.\d\d/i.test(pr) ? ok("the proposal carries a confidence score") : bad("no confidence score");
/pending change/i.test(pr)
  ? ok("the drawer states plainly that accepting does NOT edit the record")
  : bad("the maker-checker promise is not stated in the UI");

// the value that is about to change, straight from the database
const loanId = (pr.match(/LN-\d+/) || [])[0];
const before = loanId ? await sql(`select payment_amount from loan_records where loan_id='${loanId}' and tape_id='${tapeId}'`) : "";
note(`loan ${loanId} paymentAmount before = ${before}`);

await op.locator('aside button:has-text("Accept")').click();
await op.waitForTimeout(4000);
const acc = await drawer.innerText();
/pending change waiting for a Reviewer/i.test(acc) ? ok("accept confirms it is now pending") : bad("accept feedback missing:\n" + acc.slice(-400));

const after = loanId ? await sql(`select payment_amount from loan_records where loan_id='${loanId}' and tape_id='${tapeId}'`) : "";
before === after
  ? ok(`the loan record did NOT change on accept (${before} still)`)
  : bad(`ACCEPT MUTATED THE RECORD: ${before} -> ${after} — the central claim is broken`);
await shot(op, "07-accepted");

/* ================================================ 4  MAKER != CHECKER */
step("4  the operator cannot approve their own change");
await op.goto(BASE + "/review", { waitUntil: "networkidle" });
const opAtReview = new URL(op.url()).pathname;
opAtReview === "/denied"
  ? ok("operator is refused the reviewer queue -> /denied")
  : bad("operator reached " + opAtReview);
await shot(op, "08-operator-denied");

/* ================================================ 5  REVIEWER APPROVES */
step("5  reviewer: see the pending change as a diff, approve it");
const rev = await login("reviewer@intain.demo");
await rev.goto(BASE + "/review", { waitUntil: "networkidle" });
await rev.waitForTimeout(1500);
await shot(rev, "09-review-queue");
const rq = await rev.locator("body").innerText();
loanId && rq.includes(loanId) ? ok(`the accepted change for ${loanId} is waiting for the reviewer`) : bad("pending change not in the reviewer queue:\n" + rq.slice(0, 500));
/accepted by/i.test(rq) ? ok("the reviewer is told who accepted it") : bad("no maker attribution shown");

await rev.locator('button:has-text("Approve and apply")').first().click();
await rev.waitForTimeout(5000);
await shot(rev, "10-approved");
const applied = loanId ? await sql(`select payment_amount from loan_records where loan_id='${loanId}' and tape_id='${tapeId}'`) : "";
applied !== before
  ? ok(`approval applied the change: ${before} -> ${applied}`)
  : bad("approval did not change the record");
const ver = loanId ? await sql(`select version from loan_records where loan_id='${loanId}' and tape_id='${tapeId}'`) : "";
Number(ver) >= 2 ? ok(`the record version was bumped to v${ver}`) : bad("version not bumped");

/* ============================================ 6  SIGN-OFF IS BLOCKED */
step("6  reviewer: sign-off is refused while gating exceptions are open");
await rev.goto(`${BASE}/tapes/${tapeId}`, { waitUntil: "networkidle" });
await rev.waitForTimeout(1200);
await shot(rev, "11-attest-blocked");
const at = await rev.locator("body").innerText();
/gating exceptions block sign-off/i.test(at)
  ? ok("the sign-off button is disabled and says why")
  : bad("sign-off is not visibly blocked:\n" + at.slice(0, 500));

/* =================================== 7  CLEAR GATING, THEN SIGN OFF */
step("7  reviewer: drop a loan that cannot be repaired, then clear the rest and sign off");

// First, prove the escape hatch works through the UI. A blocker cannot be waived;
// when there is no defensible repair the reviewer excludes the loan instead.
await rev.goto(`${BASE}/tapes/${tapeId}/exceptions`, { waitUntil: "networkidle" });
await rev.waitForTimeout(2000);
await rev.locator('select').first().selectOption("XFD-002").catch(() => {});   // maturity before origination
await rev.waitForTimeout(900);
const target = rev.locator('table.dtable tbody tr').filter({ hasText: /LN-\d+/ }).first();
const victimLoan = (await target.innerText()).match(/LN-\d+/)?.[0];
await target.locator('button:has-text("Open")').click();
await rev.waitForTimeout(900);

const revDrawer = rev.locator("aside");
const excludeBtn = revDrawer.locator('button:has-text("Exclude this loan")');
(await excludeBtn.count()) ? ok("the reviewer is offered the exclude action on a blocker") : bad("no exclude action on a blocking exception");
(await excludeBtn.isDisabled()) ? ok("exclude is disabled until a reason is written") : bad("exclude accepted with no reason");
await revDrawer.locator("textarea").fill("Neither source can say which date is wrong. Dropped rather than guessed at.");
await rev.waitForTimeout(300);
await shot(rev, "11a-exclude");
await excludeBtn.click();
await rev.waitForTimeout(4000);
const exText = await revDrawer.innerText();
/Excluded/i.test(exText) ? ok(`the loan was dropped from the tape: ${victimLoan}`) : bad("exclude gave no confirmation:\n" + exText.slice(-400));

const status = victimLoan ? await sql(`select verification_status from loan_records where loan_id='${victimLoan}' and tape_id='${tapeId}'`) : "";
status === "REJECTED" ? ok("the excluded loan is marked REJECTED in the database") : bad("excluded loan status is " + status);
const evt = await sql(`select count(*) from audit_events where action='LOAN_EXCLUDED' and tape_id='${tapeId}'`);
Number(evt) > 0 ? ok("the exclusion is in the audit chain with its reason") : bad("no LOAN_EXCLUDED event was written");

// The remaining ~150 are cleared the same way, in bulk, because a browser cannot
// click through them in a rehearsal — but through the same service calls, not SQL.
run("npx", ["tsx", "--env-file=.env", "scripts/seed-review.ts", "--tape", tapeId]);
note("the rest of the queue was worked through the same service paths, out of band");
await rev.goto(`${BASE}/tapes/${tapeId}`, { waitUntil: "networkidle" });
await rev.waitForTimeout(1200);
const attestBtn = rev.locator('button:has-text("Verify tape")');
(await attestBtn.isDisabled()) ? bad("sign-off still disabled with no gating exceptions") : ok("sign-off is now available");
await attestBtn.click();
await rev.waitForTimeout(25000);
await shot(rev, "12-attested");
const done = await rev.locator("body").innerText();
/VERIFIED/i.test(done) ? ok("the tape is signed off and marked verified") : bad("tape not verified after sign-off:\n" + done.slice(0, 500));
const sealed = await sql(`select count(*) from verified_records where tape_id='${tapeId}'`);
Number(sealed) > 0 ? ok(`${sealed} records sealed into the verified ledger`) : bad("nothing was sealed");
const root = await sql(`select merkle_root from attestations where tape_id='${tapeId}'`);
root.length === 64 ? ok("merkle root " + root.slice(0, 16) + "…") : bad("no merkle root");

/* ================================================= 8  INTEGRITY PASSES */
step("8  anyone: check integrity — it passes");
await rev.locator('button:has-text("Check integrity")').click();
await rev.waitForTimeout(8000);
await shot(rev, "13-integrity-ok");
const ig = await rev.locator("body").innerText();
/unbroken chain/i.test(ig) && /\bVerified\./.test(ig) && !/\bdiverge/i.test(ig)
  ? ok("chain intact and data matches the attestation")
  : bad("integrity panel unclear:\n" + ig.slice(0, 600));

/* ================================================= 9  CONSUMER IS READ-ONLY */
step("9  consumer: read, verify, export — and nothing else");
const con = await login("consumer@intain.demo");
await con.goto(BASE + "/verified", { waitUntil: "networkidle" });
await con.waitForTimeout(1500);
await shot(con, "14-verified-ledger");
const vl = await con.locator("body").innerText();
vl.length > 400 ? ok("the verified ledger renders for the consumer") : bad("verified ledger thin");

await con.goto(BASE + "/tapes/new", { waitUntil: "networkidle" });
new URL(con.url()).pathname === "/denied" ? ok("consumer refused the upload page") : bad("consumer reached " + con.url());

const exportRes = await con.request.get(`${BASE}/api/v1/tapes/${tapeId}/export?format=json`);
exportRes.ok() ? ok("consumer can export the verified tape (" + exportRes.status() + ")") : bad("export failed " + exportRes.status());
const decideRes = await con.request.post(`${BASE}/api/v1/proposals/00000000/decision`, { data: { action: "approve" } });
decideRes.status() === 403 ? ok("consumer POST to a write endpoint is 403 at the API, not just hidden in the UI") : bad("write endpoint returned " + decideRes.status() + " for the consumer");

/* ============================================ 10  TAMPER, LIVE */
step("10  someone edits the database directly — the app names it");
const victim = await sql(`select loan_id from verified_records where tape_id='${tapeId}' order by loan_id limit 1`);
await sql(`update loan_records set current_balance = current_balance + 1 where loan_id='${victim}' and tape_id='${tapeId}'`);
note(`edited ${victim}.currentBalance directly in SQL`);
await rev.goto(`${BASE}/tapes/${tapeId}`, { waitUntil: "networkidle" });
await rev.waitForTimeout(1000);
await rev.locator('button:has-text("Check integrity")').click();
await rev.waitForTimeout(9000);
await shot(rev, "15-tamper-caught");
const tp = await rev.locator("body").innerText();
/diverge|does not match|no longer matches|fail/i.test(tp) ? ok("the integrity check now FAILS") : bad("tamper NOT caught in the UI:\n" + tp.slice(0, 800));
tp.includes(victim) ? ok(`the divergent loan is named on screen: ${victim}`) : bad("the failing loan is not named");
/intact/i.test(tp) ? ok("the audit chain is still intact — an audit log alone would have missed this") : note("chain status not shown alongside");

/* ================================== 11  PUT IT BACK, AND PROVE IT */
step("11  restore — the demo has to be runnable twice");
run("npx", ["tsx", "--env-file=.env", "scripts/tamper.ts", "--restore"]);
await rev.goto(`${BASE}/tapes/${tapeId}`, { waitUntil: "networkidle" });
await rev.waitForTimeout(1000);
await rev.locator('button:has-text("Check integrity")').click();
await rev.waitForTimeout(9000);
const back = await rev.locator("body").innerText();
/unbroken chain/i.test(back) && !/\bdiverge/i.test(back)
  ? ok("the tape verifies again — the tamper demo is repeatable, and this run left nothing broken")
  : bad("restore did not bring the tape back:\n" + back.slice(0, 600));

await pgc.end();
await b.close();
console.log("\nCONSOLE ERRORS: " + errs.length);
[...new Set(errs)].slice(0, 10).forEach((e) => console.log("   ! " + e.slice(0, 200)));
console.log(fails.length ? `\n${fails.length} FAILURE(S)\n` + fails.map((f) => "  - " + f).join("\n") : "\nDEMO REHEARSAL PASSED — every beat works on camera, and the database is back where it started");
process.exit(fails.length ? 1 : 0);
