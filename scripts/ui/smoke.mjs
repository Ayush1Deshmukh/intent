import { chromium } from "playwright";
const BASE=process.env.BASE_URL||"http://localhost:3000";
const SHOTS=process.env.SHOTS_DIR||"artifacts/shots";
await (await import("node:fs/promises")).mkdir(SHOTS,{recursive:true});
const EXE=process.env.PW_CHROMIUM||undefined;   // default download on most machines
const fails=[]; const ok=m=>console.log("  PASS  "+m); const bad=m=>{console.log("  FAIL  "+m);fails.push(m);};
const errs=[];

const b=await chromium.launch(EXE?{executablePath:EXE}:{});
async function session(email){
  const ctx=await b.newContext({viewport:{width:1440,height:1000}});
  const p=await ctx.newPage();
  p.on("console",m=>{if(m.type()==="error")errs.push(email+": "+m.text());});
  p.on("pageerror",e=>errs.push(email+": "+String(e)));
  await p.goto(BASE+"/login",{waitUntil:"networkidle"});
  await p.locator(`form:has(input[value="${email}"]) button`).click();
  await p.waitForURL(u=>!u.pathname.includes("login"),{timeout:20000}).catch(()=>{});
  return {ctx,p};
}
const shot=(p,n)=>p.screenshot({path:`${SHOTS}/${n}.png`,fullPage:true});

// ---------- OPERATOR ----------
console.log("--- Data Operator ---");
let {p}=await session("operator@intain.demo");
new URL(p.url()).pathname!=="/login" ? ok("operator one-click login") : bad("operator login failed");

await p.goto(BASE+"/tapes",{waitUntil:"networkidle"});
await shot(p,"03-tapes-empty");
const loader=p.locator('button:has-text("demo"),button:has-text("Demo"),button:has-text("Load")').first();
if(await loader.count()){
  await loader.click();
  await p.waitForTimeout(9000);
  ok("demo tape loaded via one click");
}else bad("no demo tape loader on /tapes");
await p.goto(BASE+"/tapes",{waitUntil:"networkidle"});
await shot(p,"04-tapes-list");

const link=p.locator('a[href^="/tapes/"]:not([href="/tapes/new"])').first();
if(!await link.count()){ bad("no tape appeared in the list"); }
const href=await link.getAttribute("href");
const tapeId=href.split("/")[2];
console.log("  tape:",tapeId);

for(const [path,name] of [["","05-tape-overview"],["/mapping","06-mapping"],["/exceptions","07-exceptions"],["/records","08-records"],["/audit","09-audit"]]){
  await p.goto(`${BASE}/tapes/${tapeId}${path}`,{waitUntil:"networkidle"});
  await p.waitForTimeout(1200);
  await shot(p,name);
  const body=await p.locator("body").innerText();
  body.length>200 ? ok(`/tapes/[id]${path||""} renders (${body.length} chars)`) : bad(`/tapes/[id]${path} looks empty`);
}
await p.goto(BASE+"/rules",{waitUntil:"networkidle"}); await shot(p,"10-rules");
ok("rules page renders");

// ---------- REVIEWER ----------
console.log("\n--- Reviewer ---");
const r=await session("reviewer@intain.demo");
new URL(r.p.url()).pathname!=="/login" ? ok("reviewer one-click login") : bad("reviewer login failed");
await r.p.goto(BASE+"/review",{waitUntil:"networkidle"}); await shot(r.p,"11-review");
ok("review queue renders");

// ---------- CONSUMER ----------
console.log("\n--- Data Consumer ---");
const c=await session("consumer@intain.demo");
await c.p.goto(BASE+"/verified",{waitUntil:"networkidle"}); await shot(c.p,"12-verified");
ok("verified ledger renders");
await c.p.goto(BASE+"/docs",{waitUntil:"networkidle"}); await c.p.waitForTimeout(1500); await shot(c.p,"13-docs");
const d=await c.p.locator("body").innerText();
d.length>300 ? ok(`/docs renders the OpenAPI spec (${d.length} chars)`) : bad("/docs looks empty");
// consumer must NOT be able to reach the upload page
await c.p.goto(BASE+"/tapes/new",{waitUntil:"networkidle"});
const after=new URL(c.p.url()).pathname;
const txt=(await c.p.locator("body").innerText()).toLowerCase();
(after==="/denied"||after!=="/tapes/new")
  ? ok("consumer is refused the upload page -> "+after) : bad("consumer reached /tapes/new — RBAC leak in UI");
await shot(c.p,"14-consumer-blocked");

await b.close();
console.log("\nCONSOLE ERRORS: "+errs.length);
[...new Set(errs)].slice(0,8).forEach(e=>console.log("   ! "+e.slice(0,180)));
console.log(fails.length?`\n${fails.length} FAILURE(S)`:"\nALL UI CHECKS PASSED");
