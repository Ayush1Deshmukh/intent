/**
 * Records the demo as a video file.
 *
 * Not a substitute for narrating it yourself — it has no audio and makes no argument.
 * What it gives you is a clean, correctly-paced capture of the software actually working,
 * to narrate over or to cut from, produced by driving the real application rather than by
 * editing screenshots together.
 *
 * One browser context throughout, signing out and back in between roles, because that is
 * what a person does and because Playwright writes one video per context.
 *
 *   npm run ui:record                      # ~4 minutes, artifacts/video/
 *   PACE=1.5 npm run ui:record             # slower, for a presenter who talks slowly
 *
 * Run `npm run ai:check` first. The AI calls are cached by prompt hash, so a warmed
 * cache keeps the recording free of a nine-second wait that reads as a stall on video.
 */
import { chromium } from "playwright";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.VIDEO_DIR || "artifacts/video";
const PACE = Number(process.env.PACE ?? 1);
await mkdir(OUT, { recursive: true });

const beat = (n, s) => console.log(`  ${String(n).padStart(2)}  ${s}`);
/** Deliberate dwell time — the viewer has to read what the presenter is talking about. */
const hold = (ms) => new Promise((r) => setTimeout(r, ms * PACE));

const sql = (q) =>
  execFileSync("docker", ["compose", "exec", "-T", "db", "psql", "-U", "postgres",
    "-d", "verified_tape", "-tAc", q], { encoding: "utf8" }).trim();

/**
 * Two tapes, because the demo genuinely needs two.
 *
 * The triage beats want a queue with open exceptions in it. The verification beats want
 * a tape that has been signed off. One tape cannot be both, which is the honest thing
 * DEMO.md says out loud rather than working around.
 */
const workingTape = process.env.TAPE || sql(
  `select t.id from tapes t join exceptions e on e.tape_id = t.id and e.status = 'OPEN'
   group by t.id order by count(*) desc limit 1`);
const sealedTape = process.env.SEALED_TAPE || sql(
  "select tape_id from attestations order by created_at desc limit 1");

if (!workingTape) {
  console.error("No tape with open exceptions. Load the demo tape and confirm its mapping first.");
  process.exit(1);
}
if (!sealedTape) {
  console.error("No signed-off tape. Run: npm run demo:reviewed");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const p = await ctx.newPage();

async function signIn(email) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hold(1200);
  await p.locator(`form:has(input[value="${email}"]) button`).click();
  await p.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }).catch(() => {});
  await hold(900);
}
async function signOut() {
  await p.locator('button:has-text("Sign out")').click().catch(() => {});
  await hold(700);
}
/** Scroll slowly enough to read, rather than jumping. */
async function reveal(px = 700, steps = 7) {
  for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, px / steps); await hold(260); }
}

console.log(`\nrecording\n  working tape ${workingTape}\n  sealed tape  ${sealedTape}\n`);

beat(1, "the thesis, on the sign-in screen");
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await hold(4200);
await reveal(420, 4);
await hold(1600);

beat(2, "operator: the tape, and where the data is");
await signIn("operator@intain.demo");
await p.goto(`${BASE}/tapes/${workingTape}`, { waitUntil: "networkidle" });
await hold(3800);                       // the counters animate up
await reveal(760, 8);
await hold(2600);                       // the three zones

beat(3, "209 exceptions collapse into a handful of root causes");
await p.goto(`${BASE}/tapes/${workingTape}/exceptions`, { waitUntil: "networkidle" });
await hold(2600);
await p.locator('button:has-text("Group by root cause")').click();
await hold(4200);
await reveal(620, 6);
await hold(2400);
await p.locator('button:has-text("Hide root causes")').click().catch(() => {});
await hold(1200);

beat(4, "one exception: explain, propose, accept");
await p.locator("select").first().selectOption("XFD-003").catch(() => {});
await hold(1400);
const row = p.locator("table.dtable tbody tr").filter({ hasText: /LN-\d+/ }).first();
if (!(await row.count())) {
  console.error("\n  No open XFD-003 row on the working tape — is its queue already worked?");
  console.error("  Load a fresh demo tape and confirm its mapping, then record again.\n");
  await ctx.close(); await browser.close(); process.exit(1);
}
await row.locator('button:has-text("Open")').click();
await hold(2200);
const drawer = p.locator("aside");
await p.locator('button:has-text("Explain")').click();
await drawer.locator("text=/What the rule checks/i").first().waitFor({ timeout: 60000 }).catch(() => {});
await hold(4600);
await p.locator('button:has-text("Propose a fix")').click();
await drawer.locator("text=/Proposed change/i").first().waitFor({ timeout: 60000 }).catch(() => {});
await hold(4800);                       // confidence, evidence, and the maker-checker note
await p.locator('aside button:has-text("Close")').click().catch(() => {});
await hold(1000);

beat(5, "the lineage: raw string, file, row, every transformation");
await p.goto(`${BASE}/tapes/${workingTape}/records`, { waitUntil: "networkidle" });
await hold(2000);
await p.locator("table.dtable tbody tr").first().click();
await hold(3400);
await reveal(700, 7);
await hold(2200);
await p.locator('aside button:has-text("Close")').click().catch(() => {});
await hold(800);

beat(6, "the chain, made visible");
await p.goto(`${BASE}/tapes/${workingTape}/audit`, { waitUntil: "networkidle" });
await hold(4200);                       // the swatches match down the page
await reveal(520, 5);
await hold(2000);

beat(7, "reviewer: the pending change, as a diff");
await signOut();
await signIn("reviewer@intain.demo");
await p.goto(`${BASE}/review`, { waitUntil: "networkidle" });
await hold(3800);

beat(8, "the sealed tape verifies");
await p.goto(`${BASE}/tapes/${sealedTape}`, { waitUntil: "networkidle" });
await hold(1800);
await p.locator('button:has-text("Check integrity")').click();
await hold(9000);                       // both stages, then the verdict
await hold(2600);

beat(9, "someone edits the database directly");
try {
  const victim = sql(`select loan_id from verified_records where tape_id='${sealedTape}' order by loan_id limit 1`);
  sql(`update loan_records set current_balance = current_balance + 1 where loan_id='${victim}' and tape_id='${sealedTape}'`);
  console.log(`      edited ${victim} in SQL — no API, no audit event`);
  await p.reload({ waitUntil: "networkidle" });
  await hold(1400);
  await p.locator('button:has-text("Check integrity")').click();
  await hold(9000);
  await hold(4200);                     // the failure names the loan; the chain is intact
} catch (e) {
  console.log("      (tamper skipped:", String(e).slice(0, 60), ")");
}

beat(10, "consumer: read-only, and the proof");
await signOut();
await signIn("consumer@intain.demo");
await p.goto(`${BASE}/verified`, { waitUntil: "networkidle" });
await hold(3400);
await p.goto(`${BASE}/docs`, { waitUntil: "networkidle" });
await hold(3000);
await reveal(600, 6);
await hold(2200);

await ctx.close();                      // flushes the video
await browser.close();

// restore, so the recording leaves nothing broken
try {
  execFileSync("npx", ["tsx", "--env-file=.env", "scripts/tamper.ts", "--restore"], { encoding: "utf8" });
  console.log("\n  restored the tampered record");
} catch { /* nothing to restore */ }

// Playwright names the file after the page, so pick by write time and skip the target
// itself — sorting by name silently selects a previous run's output.
const OUTPUT = "verified-tape-demo.webm";
const candidates = await Promise.all(
  (await readdir(OUT))
    .filter((f) => f.endsWith(".webm") && f !== OUTPUT)
    .map(async (f) => ({ f, at: (await stat(`${OUT}/${f}`)).mtimeMs })));
const newest = candidates.sort((a, b) => b.at - a.at)[0]?.f;
if (newest) {
  await rename(`${OUT}/${newest}`, `${OUT}/${OUTPUT}`);
  console.log(`\n  ${OUT}/${OUTPUT}`);
  console.log("  Narrate over it using DEMO.md, which is the same ten beats in the same order.");
  console.log("  To convert:  ffmpeg -i verified-tape-demo.webm -c:v libx264 -crf 23 verified-tape-demo.mp4\n");
}
