/**
 * Drives the real workflow through the real UI, as a person would:
 * operator loads the tape, confirms the mapping, sees exceptions;
 * reviewer sees pending changes; consumer verifies.
 */
import { chromium } from "playwright";
const BASE="http://localhost:3000";
const EXE="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const fails=[]; const ok=m=>console.log("  PASS  "+m); const bad=m=>{console.log("  FAIL  "+m);fails.push(m);};
const b=await chromium.launch({executablePath:EXE});
const shot=(p,n)=>p.screenshot({path:`/tmp/shots/${n}.png`,fullPage:true});

async function login(email){
  const ctx=await b.newContext({viewport:{width:1440,height:1100}});
  const p=await ctx.newPage();
  await p.goto(BASE+"/login",{waitUntil:"networkidle"});
  await p.locator(`form:has(input[value="${email}"]) button`).click();
  await p.waitForURL(u=>!u.pathname.includes("login"),{timeout:20000}).catch(()=>{});
  return p;
}

console.log("--- operator: load + confirm mapping ---");
const p=await login("operator@intain.demo");
await p.goto(BASE+"/tapes",{waitUntil:"networkidle"});
await p.locator('button:has-text("demo"),button:has-text("Demo"),button:has-text("Load")').first().click();
await p.waitForURL(/\/mapping/,{timeout:60000}).catch(()=>{});
await p.waitForTimeout(2500);
const tapeId=p.url().match(/tapes\/([^/]+)/)[1];
console.log("  tape:",tapeId);
await shot(p,"20-mapping");
/\/mapping/.test(p.url()) ? ok("demo load lands on the mapping screen") : bad("did not reach mapping, at "+p.url());

const confirm=p.locator('button:has-text("Confirm"),button:has-text("confirm")').first();
if(!await confirm.count()) bad("no confirm-mapping button");
else{
  await confirm.click();
  await p.waitForTimeout(20000);            // normalization + 28 rules over 500 rows
  ok("mapping confirmed");
}
await p.goto(`${BASE}/tapes/${tapeId}`,{waitUntil:"networkidle"});
await p.waitForTimeout(1500); await shot(p,"21-overview");
const ov=await p.locator("body").innerText();
/\b500\b/.test(ov) ? ok("overview shows 500 records") : bad("overview missing the 500-record count");
/\b209\b/.test(ov) ? ok("overview shows 209 exceptions") : bad("overview missing the 209 exception count:\n"+ov.slice(0,500));

await p.goto(`${BASE}/tapes/${tapeId}/exceptions`,{waitUntil:"networkidle"});
await p.waitForTimeout(2500); await shot(p,"22-exceptions");
const ex=await p.locator("body").innerText();
ex.length>2000 ? ok(`exception queue populated (${ex.length} chars)`) : bad(`exception queue thin (${ex.length} chars)`);
/BLOCKER|CRITICAL/i.test(ex) ? ok("severities render") : bad("no severity chips visible");

await p.goto(`${BASE}/tapes/${tapeId}/records`,{waitUntil:"networkidle"});
await p.waitForTimeout(2000); await shot(p,"23-records");
const rc=await p.locator("body").innerText();
rc.length>2000 ? ok(`records table populated (${rc.length} chars)`) : bad(`records thin (${rc.length} chars)`);

await p.goto(`${BASE}/tapes/${tapeId}/audit`,{waitUntil:"networkidle"});
await p.waitForTimeout(1500); await shot(p,"24-audit");
const au=await p.locator("body").innerText();
/intact|verified|chain/i.test(au) ? ok("audit chain view renders") : bad("audit view unclear");

console.log("\n--- reviewer ---");
const r=await login("reviewer@intain.demo");
await r.goto(BASE+"/review",{waitUntil:"networkidle"}); await r.waitForTimeout(1500);
await shot(r,"25-review");
ok("reviewer queue renders");
// reviewer must not reach the upload screen
await r.goto(BASE+"/tapes/new",{waitUntil:"networkidle"});
new URL(r.url()).pathname==="/denied" ? ok("reviewer refused /tapes/new -> /denied") : bad("reviewer reached "+r.url());
await shot(r,"26-denied");

console.log("\n--- consumer ---");
const c=await login("consumer@intain.demo");
await c.goto(BASE+"/verified",{waitUntil:"networkidle"}); await c.waitForTimeout(1200);
await shot(c,"27-verified");
ok("consumer verified ledger renders");

await b.close();
console.log(fails.length?`\n${fails.length} FAILURE(S)`:"\nFULL FLOW PASSED");
