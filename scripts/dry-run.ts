/** Runs the whole pipeline over the fixtures with no database, and prints what it found. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBuffer } from "../src/lib/ingest/parse";
import { runPipeline, proposeMappings } from "../src/lib/ingest/pipeline";
import { RULE_BY_CODE } from "../src/lib/rules/catalog";

const ROOT = join(import.meta.dirname ?? process.cwd(), "..");
const read = (p: string) => parseBuffer(p, readFileSync(join(ROOT, "fixtures", p)));

const tape = read("loan_tape.csv");
const servicer = read("servicer_update.csv");
const manifest = read("document_manifest.csv");
const SERVICERS = new Set(["SVC-01","SVC-02","SVC-03","SVC-04","SVC-05","SVC-06"]);

console.log("\n=== HEADER MAPPING ===");
for (const m of proposeMappings(tape)) {
  console.log(
    `  ${m.sourceHeader.padEnd(16)} -> ${(m.canonicalField ?? "(unmapped)").padEnd(18)} ` +
    `${m.method.padEnd(6)} ${m.confidence.toFixed(2)}  ${m.rationale ?? ""}`);
}

const res = runPipeline(tape, [
  { kind: "SERVICER_UPDATE", file: servicer },
  { kind: "DOCUMENT_MANIFEST", file: manifest },
], { asOf: "2026-07-31", servicers: SERVICERS });

console.log("\n=== COLUMN FORMAT DECISIONS ===");
for (const [f, h] of Object.entries(res.hints)) console.log(`  ${f.padEnd(18)} ${JSON.stringify(h)}`);

const bySeverity: Record<string, number> = {};
const byRule: Record<string, number> = {};
for (const e of res.exceptions) {
  bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
  byRule[e.ruleCode] = (byRule[e.ruleCode] ?? 0) + 1;
}
const affected = new Set(res.exceptions.map((e) => e.recordId).filter(Boolean));

console.log("\n=== RESULT ===");
console.log(`  rows                 ${res.rows.length}`);
console.log(`  exceptions           ${res.exceptions.length}`);
console.log(`  rows with exceptions ${affected.size}  (clean ${res.rows.length - affected.size})`);
console.log(`  cross-source conflicts ${res.conflictCount}`);
console.log(`  unmapped headers     ${res.unmapped.join(", ") || "(none)"}`);
console.log(`  severity            `, bySeverity);
console.log("\n=== BY RULE ===");
for (const [code, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code}  ${String(n).padStart(4)}  ${RULE_BY_CODE.get(code)?.name ?? ""}`);
}
const clusters: Record<string, number> = {};
for (const e of res.exceptions) if (e.clusterKey) clusters[e.clusterKey] = (clusters[e.clusterKey] ?? 0) + 1;
console.log("\n=== DETERMINISTIC CLUSTERS (the AI fallback) ===");
for (const [k, n] of Object.entries(clusters).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

const clean = parseBuffer("clean_tape_50.csv", readFileSync(join(ROOT, "fixtures/clean_tape_50.csv")));
const cleanRes = runPipeline(clean, [], { asOf: "2026-07-31", servicers: SERVICERS });
console.log(`\n=== CANARY  clean_tape_50.csv -> ${cleanRes.exceptions.length} exceptions ${cleanRes.exceptions.length === 0 ? "OK" : "FAIL: " + cleanRes.exceptions.map(e=>e.ruleCode+":"+e.observed).join(", ")}`);
