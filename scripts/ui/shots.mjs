import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const OUT = "artifacts/ui";
await mkdir(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push(String(e).slice(0, 200)));
p.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });

await p.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/01-login.png` });
await p.locator('form:has(input[value="operator@intain.demo"]) button').click();
await p.waitForTimeout(3500);

const tape = process.env.TAPE;
await p.goto(`http://localhost:3000/tapes/${tape}`, { waitUntil: "networkidle" });
await p.waitForTimeout(1400);
await p.screenshot({ path: `${OUT}/02-overview.png` });

await p.goto(`http://localhost:3000/tapes/${tape}/exceptions`, { waitUntil: "networkidle" });
await p.waitForTimeout(2200);
await p.screenshot({ path: `${OUT}/03-queue.png` });
await p.locator('button:has-text("Group by root cause")').click();
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/04-clusters.png` });

console.log("console errors:", errs.length, errs.slice(0, 5));
await b.close();
