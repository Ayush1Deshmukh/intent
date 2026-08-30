/**
 * Screenshots of every screen in the demo path, as all three roles.
 * A design pass on a dense application is not doable by reading JSX.
 *
 *   TAPE=<id> npm run ui:shots
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.SHOTS_DIR || "artifacts/ui";
await mkdir(OUT, { recursive: true });

const b = await chromium.launch();
const errs = [];
async function as(email) {
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  p.on("pageerror", (e) => errs.push(`${email}: ${String(e).slice(0, 160)}`));
  p.on("console", (m) => { if (m.type() === "error") errs.push(`${email}: ${m.text().slice(0, 140)}`); });
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.locator(`form:has(input[value="${email}"]) button`).click();
  await p.waitForTimeout(3000);
  return p;
}
const shot = async (p, name, wait = 1400) => {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${OUT}/${name}.png` });
};

const tape = process.env.TAPE;

const anon = await (await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })).newPage();
await anon.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shot(anon, "01-login", 600);

const op = await as("operator@intain.demo");
await op.goto(`${BASE}/tapes`, { waitUntil: "networkidle" });        await shot(op, "02-tapes");
if (tape) {
  await op.goto(`${BASE}/tapes/${tape}`, { waitUntil: "networkidle" });            await shot(op, "03-overview");
  await op.goto(`${BASE}/tapes/${tape}/exceptions`, { waitUntil: "networkidle" }); await shot(op, "04-queue", 2400);
  await op.locator('button:has-text("Group by root cause")').click();              await shot(op, "05-clusters", 1000);
  await op.locator('button:has-text("Hide root causes")').click();
  await op.waitForTimeout(600);
  await op.locator('table.dtable tbody tr button:has-text("Open")').first().click();
  await shot(op, "06-drawer", 1000);
  await op.goto(`${BASE}/tapes/${tape}/records`, { waitUntil: "networkidle" });    await shot(op, "07-records", 1800);
  await op.goto(`${BASE}/tapes/${tape}/audit`, { waitUntil: "networkidle" });      await shot(op, "08-audit", 1600);
}
await op.goto(`${BASE}/rules`, { waitUntil: "networkidle" });        await shot(op, "09-rules");

const rev = await as("reviewer@intain.demo");
await rev.goto(`${BASE}/review`, { waitUntil: "networkidle" });      await shot(rev, "10-review");

const con = await as("consumer@intain.demo");
await con.goto(`${BASE}/verified`, { waitUntil: "networkidle" });    await shot(con, "11-verified", 1800);
await con.goto(`${BASE}/docs`, { waitUntil: "networkidle" });        await shot(con, "12-docs", 1800);
await con.goto(`${BASE}/tapes/new`, { waitUntil: "networkidle" });   await shot(con, "13-denied", 900);

console.log("console errors:", errs.length);
[...new Set(errs)].slice(0, 6).forEach((e) => console.log("  ! " + e));
await b.close();
