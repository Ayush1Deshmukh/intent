/**
 * Proves the model is actually wired up — and warms the cache so the demo does not
 * depend on the venue wifi.
 *
 * Runs all four AI jobs against whatever tape is currently loaded, prints what came
 * back, and reports which of them reached the API versus which quietly fell back to
 * the deterministic path. Every successful call lands in `ai_cache`, keyed by prompt
 * hash, so the same click during the demo is instant, free, and offline-proof.
 *
 *   npm run ai:check          # every job, newest tape
 *   npm run ai:check -- explain propose
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, tapes, exceptions, rules } from "@/lib/db";
import { explainException, proposeFix, clusterExceptions, authorRule } from "@/lib/ai/jobs";
import { aiEnabled, modelName, provider, providerLabel } from "@/lib/ai/client";
import { setupHint } from "@/lib/ai/providers";

const wanted = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")));
const want = (job: string) => wanted.size === 0 || wanted.has(job);

const line = (s = "") => console.log(s);
const head = (s: string) => line(`\n\x1b[1m--- ${s} ---\x1b[0m`);
const kv = (k: string, v: unknown) => line(`  ${k.padEnd(16)} ${v}`);
const wrap = (s: string, indent = "    ") =>
  s.replace(/(.{1,92})(\s|$)/g, `${indent}$1\n`).trimEnd();

let live = 0, fell = 0;

/**
 * Free tiers meter tokens per minute, and this script deliberately fires every job
 * back to back — which is not how anyone uses the app, but is exactly how you
 * rate-limit yourself and then conclude the integration is broken. So it paces.
 * `AI_CHECK_PACE_MS=0` turns it off on a paid key.
 */
const paceMs = process.env.AI_CHECK_PACE_MS !== undefined
  ? Number(process.env.AI_CHECK_PACE_MS)
  : (provider()?.freeTpm ? 16000 : 0);
let paced = false;
async function pace() {
  if (!paceMs) return;
  if (paced) {
    // A carriage return tidies a terminal and corrupts a log file, so only do it
    // when there is a terminal to tidy.
    const tty = process.stdout.isTTY;
    const msg = `  \x1b[2m…pausing ${paceMs / 1000}s for the per-minute token budget\x1b[0m`;
    process.stdout.write(tty ? msg + "\r" : msg + "\n");
    await new Promise((r) => setTimeout(r, paceMs));
    if (tty) process.stdout.write(" ".repeat(70) + "\r");
  }
  paced = true;
}

async function main() {
  head("configuration");
  const p = provider();
  kv("provider", providerLabel());
  kv("model", modelName());
  kv("endpoint", p ? p.baseUrl : "—");
  kv("key", p ? (p.apiKey ? `set (${p.apiKey.length} chars)` : "none needed") : "not configured");
  if (!aiEnabled()) {
    line("");
    line(setupHint().split("\n").map((l) => "  " + l).join("\n"));
    line("");
  }

  const [tape] = await db.select().from(tapes).orderBy(desc(tapes.createdAt)).limit(1);
  if (!tape) {
    line("\n  No tape loaded. Run the app, load the demo tape, confirm the mapping, then re-run.\n");
    process.exit(1);
  }
  kv("tape", `${tape.name}  (${tape.id})`);

  // one exception per interesting rule, so the jobs get a real spread of inputs
  const picks = await db.select({ exc: exceptions, rule: rules })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .where(and(eq(exceptions.tapeId, tape.id), inArray(rules.code, ["XFD-001", "CON-001", "FMT-001", "XFD-003"])))
    .limit(4);
  kv("exceptions", `${picks.length} sampled`);

  /* ------------------------------------------------------------- 1 EXPLAIN */
  if (want("explain")) {
    head("1 · explain");
    for (const { exc, rule } of picks.slice(0, 2)) {
      await pace();
      const r = await explainException(exc.id);
      if (r.source === "RULE") fell++; else live++;
      kv("rule", `${rule.code}  ${rule.name}`);
      kv("source", `${r.source}${r.model ? ` · ${r.model}` : ""}`);
      line(wrap(`what it checks: ${r.whatTheRuleChecks}`));
      line(wrap(`likely cause:   ${r.likelyCause}`));
      line(wrap(`if unfixed:     ${r.downstreamRisk}`));
      line();
    }
  }

  /* ------------------------------------------------------------- 2 PROPOSE */
  if (want("propose")) {
    head("2 · propose");
    for (const { exc, rule } of picks.slice(0, 3)) {
      await pace();
      const p = await proposeFix(exc.id);
      if (!p) { kv(rule.code, "no defensible proposal — correct for some rules"); continue; }
      if (p.source === "RULE") fell++; else live++;
      kv("rule", `${rule.code}  ${rule.name}`);
      kv("source", `${p.source}${p.model ? ` · ${p.model}` : ""}`);
      kv("change", `${p.field}: ${exc.observed ?? "—"} -> ${p.toValue ?? "(none)"}`);
      kv("confidence", p.confidence.toFixed(2));
      line(wrap(`rationale: ${p.rationale}`));
      line();
    }
  }

  /* ------------------------------------------------------------- 3 CLUSTER */
  if (want("cluster")) {
    head("3 · cluster");
    await pace();
    const clusters = await clusterExceptions(tape.id);
    if (clusters.some((c) => c.source !== "RULE")) live++; else fell++;
    kv("clusters", clusters.length);
    for (const c of clusters) {
      line(`\n  \x1b[1m${c.label}\x1b[0m  (${c.exceptionIds.length} exceptions, ${c.source.toLowerCase()}, ${c.confidence.toFixed(2)})`);
      line(wrap(c.rootCause, "      "));
      line(wrap(`suggested: ${c.suggestedAction}`, "      "));
    }
    line();
  }

  /* -------------------------------------------------------------- 4 AUTHOR */
  if (want("author")) {
    head("4 · author a rule from a sentence");
    const sentences = [
      "Flag any loan in California with an adjustable rate above 10 percent.",
      "Flag loans where the credit score is under 600 and the balance is over 400000.",
      "Flag loans whose borrower has a suspicious vibe.",   // must be refused, not invented
    ];
    for (const s of sentences) {
      await pace();
      const r = await authorRule(s);
      line(`\n  \x1b[2m"${s}"\x1b[0m`);
      if ("error" in r && r.error) { line(wrap(`refused: ${r.error}`, "      ")); fell++; continue; }
      const rule = r as { name: string; severity: string; expected: string; expression: unknown; source?: string };
      if (rule.source && rule.source !== "RULE") live++; else fell++;
      kv("  name", rule.name);
      kv("  severity", rule.severity);
      kv("  expected", rule.expected);
      line("      expression " + JSON.stringify(rule.expression));
    }
    line();
  }

  head("result");
  kv("reached the API", live);
  kv("fell back", fell);
  line(live > 0
    ? "\n  The model is wired up, and every response above passed its Zod gate.\n  Cached by prompt hash — the same clicks in the demo will not call out again.\n"
    : "\n  Nothing reached the API. Everything above came from the deterministic path,\n  which is a working demo but does not prove the AI layer.\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
