/**
 * Generates the demo fixtures AND the answer key, from one source of truth so the
 * two can never drift.
 *
 *   fixtures/loan_tape.csv          500 rows, messy headers, 14 planted defect classes
 *   fixtures/servicer_update.csv    a later servicing extract that disagrees on some loans
 *   fixtures/document_manifest.csv  which loans actually have their paperwork
 *   fixtures/clean_tape_50.csv      the regression canary: must produce zero exceptions
 *   docs/defects.md                 the answer key
 *
 * Deterministic: seeded PRNG, defects planted at fixed row indices.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? process.cwd(), "..");
const N = 500;

/* ------------------------------------------------------------------ prng */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260826);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const intBetween = (a: number, b: number) => Math.floor(between(a, b + 1));

/* ------------------------------------------------------------- defect map */
/** rowIndex sets, fixed so the answer key is exact */
const S = (start: number, count: number, step = 1) =>
  new Set(Array.from({ length: count }, (_, i) => start + i * step));

const D = {
  dmyDates:        S(3, 47, 7),      // written DD/MM by the second servicer
  excelMaturity:   S(5, 15, 23),     // maturity as an Excel serial number
  currencyText:    S(0, 60, 8),      // "$412,000.00"
  accountingNeg:   S(11, 3, 137),    // "(1,234.56)" -> a negative balance
  rateAsPercent:   S(17, 3, 151),    // column is decimal form; these rows are percent
  ficoBlank:       S(1, 110, 4),     // FICO empty across 22% of the tape
  ficoImpossible:  S(29, 6, 71),     // 8500, 250, 0 ...
  balanceOverOrig: S(13, 12, 37),    // current balance above original principal
  paymentBroken:   S(19, 18, 26),    // payment off by 5-12% from amortizing
  dupIds:          S(41, 6, 79),     // three pairs of duplicated ids
  stateNames:      S(2, 30, 11),     // "California", "Calif.", "CALIF"
  stateJunk:       S(9, 14, 33),     // "Ontario", "XX", "N/A"
  dpdVsStatus:     S(7, 20, 19),     // days past due > 0 while marked CURRENT
  paidOffBalance:  S(23, 8, 53),     // PAID_OFF with a balance still outstanding
  placeholderDate: S(31, 4, 101),    // 1900-01-01
  unknownServicer: S(43, 5, 89),     // servicer not in the reference list
  staleAsOf:       S(6, 12, 39),     // not refreshed within the reporting period
  zipStripped:     S(4, 21, 17),     // Excel ate the leading zero
  rateOutlier:     S(47, 2, 199),    // 19.75% in a 4-8% book
  impossibleDate:  S(8, 12, 41),     // 31/02, 31/04 — invalid under either ordering
  missingLoanId:   S(37, 4, 113),    // no identifier at all
  termJunk:        S(21, 3, 157),    // 600-month term
  statusJunk:      S(53, 5, 107),    // a status vocabulary this system does not know
  dpdNegative:     S(27, 2, 173),    // negative days past due
  balanceAsText:   S(33, 3, 149),    // "see servicing file" in a money column
  maturityJunk:    S(15, 4, 121),    // maturity date that cannot be read at all
  transposedDates: S(25, 5, 93),     // maturity and origination swapped
  zipJunk:         S(39, 3, 143),    // a postal code that is not digits
  twinNoId:        S(45, 2, 211),    // same borrower/principal/date, no identifier
};

const STATES = ["CA","TX","FL","NY","IL","PA","OH","GA","NC","MI","NJ","VA","WA","AZ","MA","TN","IN","MO","MD","WI"];
const SERVICERS = ["SVC-01","SVC-02","SVC-03","SVC-04","SVC-05","SVC-06"];
const BAD_SERVICERS = ["SVC-99","LEGACY-2","","SVCX","OLD-SVC"];
const PRODUCTS = ["Fixed Rate","Fixed","ARM","Adjustable Rate","HELOC","Auto","Personal"];
const _FIRST = ["James","Maria","Wei","Aisha","Daniel","Priya","Luis","Emma","Kofi","Sofia","Noah","Yuki","Omar","Hannah","Diego","Fatima","Liam","Ingrid","Tomas","Chen"];
const _LAST  = ["Okafor","Nguyen","Silva","Patel","Kowalski","Rossi","Andersen","Haddad","Murphy","Tanaka","Costa","Bergman","Ali","Novak","Reyes","Dubois","Larsen","Iqbal","Moreau","Weber"];

const pad = (n: number, w = 6) => String(n).padStart(w, "0");
const money = (n: number) => n.toFixed(2);
const mdy = (d: Date) => `${String(d.getUTCMonth()+1).padStart(2,"0")}/${String(d.getUTCDate()).padStart(2,"0")}/${d.getUTCFullYear()}`;
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (d: Date, m: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));
const excelSerial = (d: Date) => Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);

function amort(principal: number, annualPct: number, months: number): number {
  const r = annualPct / 100 / 12;
  if (r <= 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

const csv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";

/* ------------------------------------------------------------------ build */
type Loan = {
  index: number; id: string; borrowerId: string; product: string;
  orig: Date; mat: Date; origBal: number; currBal: number; ratePct: number;
  term: number; payment: number; status: string; dpd: number; state: string;
  zip: string; fico: number | null; appraised: number; servicer: string;
  asOf: Date; notes: string; defects: string[];
};

const REPORT_DATE = new Date(Date.UTC(2026, 6, 31)); // 2026-07-31 reporting period
const loans: Loan[] = [];

for (let i = 0; i < N; i++) {
  const defects: string[] = [];
  const id = `LN-${pad(i + 1)}`;
  const term = pick([120, 180, 240, 360, 360, 360, 60, 84]);
  const orig = new Date(Date.UTC(intBetween(2015, 2024), intBetween(0, 11), intBetween(1, 28)));
  const mat = addMonths(orig, term);
  const origBal = Math.round(between(45_000, 850_000) / 500) * 500;
  const ratePct = Math.round(between(3.75, 8.25) * 1000) / 1000;
  const paidPct = between(0.05, 0.55);
  const currBal = Math.round(origBal * (1 - paidPct) * 100) / 100;
  const payment = Math.round(amort(origBal, ratePct, term) * 100) / 100;
  let status = "Current";
  let dpd = 0;
  if (rnd() < 0.09) { dpd = pick([30, 45, 60, 90, 120]); status = dpd >= 90 ? "Default" : "Delinquent"; }
  const state = pick(STATES);
  const zip = pad(intBetween(1001, 99950), 5);
  const fico = intBetween(580, 820);
  const appraised = Math.round(origBal * between(1.1, 1.6) / 1000) * 1000;
  const servicer = pick(SERVICERS);
  const asOf = new Date(REPORT_DATE.getTime() - intBetween(0, 25) * 86400000);
  const notes = pick(["", "", "", "refi", "escrow waived", "see servicing file", "modified 2023"]);

  loans.push({ index: i, id, borrowerId: `B-${pad(intBetween(1, 470), 5)}`, product: pick(PRODUCTS),
    orig, mat, origBal, currBal, ratePct, term, payment, status, dpd, state, zip,
    fico, appraised, servicer, asOf, notes, defects });
}

/* plant the defects -------------------------------------------------------- */
const dupSourceFor = new Map<number, number>();
{
  const dupIdx = [...D.dupIds];
  for (let k = 0; k + 1 < dupIdx.length; k += 2) dupSourceFor.set(dupIdx[k + 1], dupIdx[k]);
}

for (const l of loans) {
  const i = l.index;
  if (D.ficoBlank.has(i))        { l.fico = null; l.defects.push("fico-blank"); }
  if (D.ficoImpossible.has(i))   { l.fico = pick([8500, 250, 0, 900, 45, 1200]); l.defects.push("fico-impossible"); }
  if (D.balanceOverOrig.has(i))  { l.currBal = Math.round(l.origBal * between(1.02, 1.18) * 100) / 100; l.defects.push("balance-over-original"); }
  if (D.paymentBroken.has(i))    { l.payment = Math.round(l.payment * between(1.05, 1.12) * 100) / 100; l.defects.push("payment-not-amortizing"); }
  if (D.dpdVsStatus.has(i))      { l.dpd = pick([15, 30, 45, 60, 75]); l.status = "Current"; l.defects.push("dpd-vs-status"); }
  if (D.paidOffBalance.has(i))   { l.status = "Paid Off"; l.defects.push("paidoff-with-balance"); }
  // a servicer whose own vocabulary never got mapped: not invalid to them, unreadable here
  if (D.statusJunk.has(i))       { l.status = pick(["Active", "In Repayment", "30-DAY", "Closed-Paid", "REO"]); l.defects.push("status-unrecognised"); }
  if (D.unknownServicer.has(i))  { l.servicer = pick(BAD_SERVICERS); l.defects.push("unknown-servicer"); }
  if (D.staleAsOf.has(i))        { l.asOf = new Date(REPORT_DATE.getTime() - intBetween(120, 400) * 86400000); l.defects.push("stale-as-of"); }
  if (D.placeholderDate.has(i))  { l.orig = new Date(Date.UTC(1900, 0, 1)); l.defects.push("placeholder-date"); }
  if (D.termJunk.has(i))         { l.term = 600; l.defects.push("term-out-of-range"); }
  if (D.dpdNegative.has(i))      { l.dpd = -10; l.defects.push("dpd-negative"); }
  if (dupSourceFor.has(i))       { l.id = loans[dupSourceFor.get(i)!].id; l.defects.push("duplicate-loan-id"); }
  if (D.missingLoanId.has(i))    { l.id = ""; l.defects.push("loan-id-missing"); }
  if (D.transposedDates.has(i))  { const t = l.orig; l.orig = l.mat; l.mat = t; l.defects.push("dates-transposed"); }
}

{
  const twins = [...D.twinNoId];
  if (twins.length === 2) {
    const [a, b] = twins;
    loans[a].id = ""; loans[b].id = "";
    loans[b].borrowerId = loans[a].borrowerId;
    loans[b].origBal = loans[a].origBal;
    loans[b].orig = loans[a].orig;
    loans[b].mat = loans[a].mat;
    loans[b].term = loans[a].term;
    loans[a].defects.push("twin-no-identifier");
    loans[b].defects.push("twin-no-identifier");
  }
}

/* ------------------------------------------------------- write loan_tape */
/**
 * Deliberately messy, and deliberately complete.
 *
 * Every field the challenge's example dataset lists appears here under a header a real
 * tape would actually use — "Purpose", "Grade", "Emp Length", "Income Band", "Servicer
 * Name", "Last Paid", "Source System" — so the mapping layer is exercised against the
 * organizer's schema rather than only against a schema of our own choosing. `Col_17`
 * (appraised value) still has no recognisable name, and `Notes` is still free text that
 * must stay unmapped: the point is a file where most columns resolve and two do not.
 */
const TAPE_HEADERS = [
  "Loan No","Borrower ID","Product","Purpose","Orig Dt","Mat Dt","Orig Bal ($)","Curr Bal ",
  "Int Rate","Term","P&I","Status","DPD","Last Paid","Prop St","Zip","FICO","Grade",
  "Emp Length","Income Band","Col_17","Svcr","Servicer Name","As Of",
  "Source System","Pool Cd","Notes",
];

const PURPOSES = ["Purchase", "Refinance", "Cash-out refi", "Home improvement", "Debt consolidation"];
const GRADES = ["A", "A-", "B+", "B", "B-", "C+", "C"];
const EMP_LENGTHS = ["< 1 year", "1 year", "2 years", "3 years", "5 years", "7 years", "10+ years"];
const INCOME_BANDS = ["<50k", "50-75k", "75-100k", "100-150k", "150-250k", "250k+"];
const SOURCE_SYSTEMS = ["ENCOMPASS", "FISERV", "BLACKKNIGHT", "SHAWBROOK", "LEGACY-AS400"];

function stateCell(l: Loan): string {
  if (D.stateJunk.has(l.index)) { l.defects.push("state-unresolvable"); return pick(["Ontario","XX","N/A","--","Unknown"]); }
  if (D.stateNames.has(l.index)) {
    l.defects.push("state-as-name");
    const NAMES: Record<string,string[]> = { CA:["California","Calif.","CALIF"], TX:["Texas","Tex."], FL:["Florida","Fla."], NY:["New York","N.Y."] };
    return pick(NAMES[l.state] ?? [l.state]);
  }
  return l.state;
}

function balanceCell(l: Loan): string {
  if (D.balanceAsText.has(l.index)) { l.defects.push("balance-as-free-text"); return pick(["see servicing file","TBD","pending"]); }
  if (D.accountingNeg.has(l.index)) { l.defects.push("accounting-negative"); return `(${l.currBal.toLocaleString("en-US",{minimumFractionDigits:2})})`; }
  if (D.currencyText.has(l.index))  { l.defects.push("currency-as-text");    return `$${l.currBal.toLocaleString("en-US",{minimumFractionDigits:2})}`; }
  return money(l.currBal);
}

const tapeRows: string[][] = [TAPE_HEADERS];
for (const l of loans) {
  const origCell = D.impossibleDate.has(l.index)
    ? (l.defects.push("date-impossible"), pick(["31/02/2024", "31/04/2023", "30/02/2022", "31/09/2021"]))
    : D.dmyDates.has(l.index)
      ? (l.defects.push("date-written-ddmm"), dmy(l.orig))
      : mdy(l.orig);
  const matCell = D.maturityJunk.has(l.index)
    ? (l.defects.push("maturity-unreadable"), pick(["04-2049", "n/a", "TBD", "00/00/0000"]))
    : D.excelMaturity.has(l.index)
    ? (l.defects.push("maturity-excel-serial"), String(excelSerial(l.mat)))
    : mdy(l.mat);
  // the rate column is written in DECIMAL form; a few rows were keyed as percent
  const rateCell = D.rateAsPercent.has(l.index)
    ? (l.defects.push("rate-scale-mismatch"), (l.ratePct).toFixed(3))
    : D.rateOutlier.has(l.index)
      ? (l.defects.push("rate-outlier"), (19.75 / 100).toFixed(5))
      : (l.ratePct / 100).toFixed(5);
  const zipCell = D.zipJunk.has(l.index)
    ? (l.defects.push("zip-not-numeric"), pick(["ABCDE", "9021X", "-----"]))
    : D.zipStripped.has(l.index)
    ? (l.defects.push("zip-leading-zero-stripped"), String(Number(l.zip)).slice(0, 4))
    : l.zip;

  // the last payment date sits between origination and the as-of date, as it would
  const lastPaid = new Date(l.asOf.getTime() - Math.floor(rnd() * 45) * 86400000);

  tapeRows.push([
    l.id, l.borrowerId, l.product, pick(PURPOSES), origCell, matCell,
    `$${l.origBal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    balanceCell(l), rateCell, String(l.term), money(l.payment),
    l.status, String(l.dpd), isoDay(lastPaid), stateCell(l), zipCell,
    l.fico === null ? "" : String(l.fico), pick(GRADES),
    pick(EMP_LENGTHS), pick(INCOME_BANDS),
    String(l.appraised), l.servicer, `${l.servicer} Servicing LLC`, isoDay(l.asOf),
    pick(SOURCE_SYSTEMS),
    pick(["P-2024-A", "P-2024-B", "P-2023-C"]), l.notes,
  ]);
}

/* -------------------------------------------------- servicer_update.csv */
const SERVICER_HEADERS = ["Loan No","UPB","Days Delinquent","Loan Status","Report Date"];
const servicerRows: string[][] = [SERVICER_HEADERS];
const conflicted: string[] = [];
const seenIds = new Set<string>();
for (const l of loans) {
  if (seenIds.has(l.id)) continue;
  if (l.index % 4 !== 0) continue;                 // the servicer covers a quarter of the book
  seenIds.add(l.id);
  const disagrees = l.index % 36 === 0;            // ~14 of them materially disagree
  const upb = disagrees
    ? Math.round(l.currBal * between(0.94, 0.985) * 100) / 100
    : l.currBal;
  if (disagrees) conflicted.push(l.id);
  servicerRows.push([
    l.id, money(upb), String(l.dpd),
    l.status === "Paid Off" ? "Paid Off" : l.dpd > 0 ? "Delinquent" : "Current",
    isoDay(new Date(REPORT_DATE.getTime() + 5 * 86400000)),   // five days newer than the tape
  ]);
}

/* ------------------------------------------------ document_manifest.csv */
const MANIFEST_HEADERS = ["Loan No","Promissory Note","Security Instrument"];
const manifestRows: string[][] = [MANIFEST_HEADERS];
const missingDocs: string[] = [];
const partialDocs: string[] = [];
const seenM = new Set<string>();
for (const l of loans) {
  if (seenM.has(l.id)) continue;
  seenM.add(l.id);
  let note = "Y", sec = "Y";
  if (l.index % 47 === 0) { note = "N"; sec = "N"; missingDocs.push(l.id); }
  else if (l.index % 31 === 0) { sec = "N"; partialDocs.push(l.id); }
  manifestRows.push([l.id, note, sec]);
}

/* -------------------------------------------------- clean_tape_50.csv */
const cleanRows: string[][] = [["loanId","borrowerId","loanType","originationDate","maturityDate","originalPrincipal","currentBalance","interestRate","termMonths","paymentAmount","paymentStatus","daysPastDue","borrowerState","borrowerZip","creditScore","appraisedValue","servicerId","lastUpdatedAt"]];
for (let i = 0; i < 50; i++) {
  const term = 360;
  const orig = new Date(Date.UTC(2019, i % 12, 10));
  const mat = addMonths(orig, term);
  const origBal = 300_000 + i * 1000;
  const ratePct = 5.5;
  cleanRows.push([
    `CLEAN-${pad(i + 1, 4)}`, `CB-${pad(i + 1, 4)}`, "FIXED", isoDay(orig), isoDay(mat),
    money(origBal), money(Math.round(origBal * 0.8 * 100) / 100), ratePct.toFixed(4),
    String(term), money(Math.round(amort(origBal, ratePct, term) * 100) / 100),
    "CURRENT", "0", STATES[i % STATES.length], pad(10000 + i * 7, 5),
    String(700 + (i % 100)), money(origBal * 1.3), "SVC-01", isoDay(REPORT_DATE),
  ]);
}

/* ------------------------------------------------------------------ emit */
mkdirSync(join(ROOT, "fixtures"), { recursive: true });
mkdirSync(join(ROOT, "docs"), { recursive: true });

// a UTF-8 BOM on the primary file, because real exports have one
writeFileSync(join(ROOT, "fixtures/loan_tape.csv"), "﻿" + csv(tapeRows));
writeFileSync(join(ROOT, "fixtures/servicer_update.csv"), csv(servicerRows));
writeFileSync(join(ROOT, "fixtures/document_manifest.csv"), csv(manifestRows));
writeFileSync(join(ROOT, "fixtures/clean_tape_50.csv"), csv(cleanRows));

const byDefect = new Map<string, string[]>();
for (const l of loans) for (const d of l.defects) {
  if (!byDefect.has(d)) byDefect.set(d, []);
  byDefect.get(d)!.push(l.id);
}

const answer = [
  "# Answer key — planted defects",
  "",
  "Generated by `scripts/generate-tape.ts` from the same source of truth as the CSVs,",
  "so this file cannot drift from the fixtures. Regenerate with `npm run gen:tape`.",
  "",
  `- \`loan_tape.csv\` — ${N} rows, 19 columns, UTF-8 BOM, one free-text column (\`Notes\`) that must stay unmapped`,
  `- \`servicer_update.csv\` — ${servicerRows.length - 1} loans, reported five days AFTER the tape`,
  `- \`document_manifest.csv\` — ${manifestRows.length - 1} loans; ${missingDocs.length} with no paperwork, ${partialDocs.length} partial`,
  `- \`clean_tape_50.csv\` — the regression canary: must produce zero exceptions`,
  "",
  "## Column-level traps (the coercion layer should absorb these silently)",
  "",
  "| Trap | Where | What the system must do |",
  "|---|---|---|",
  "| Rate column written in DECIMAL form (`0.05500`) | all rows | detect the scale from the column median and rescale to percent |",
  "| Currency with `$` and thousands separators | `Curr Bal `, `Orig Bal ($)` | strip and parse to a fixed-scale decimal |",
  "| Excel serial dates | `Mat Dt` | convert from the 1899-12-30 epoch |",
  "| Leading zeros eaten by Excel | `Zip` | pad back to five digits |",
  "| Header with a trailing space | `Curr Bal ` | normalize before matching |",
  "| UTF-8 BOM | first header | strip before matching |",
  "| Column with no name a person would recognise | `Col_17` | infer from value shape, then ask a human to confirm |",
  "",
  "## Planted defect classes",
  "",
  "| Class | Loans | Example ids |",
  "|---|---|---|",
  ...[...byDefect.entries()].sort((a, b) => b[1].length - a[1].length).map(
    ([d, ids]) => `| \`${d}\` | ${ids.length} | ${ids.slice(0, 4).join(", ")} |`),
  "",
  `## Cross-source conflicts (${conflicted.length})`,
  "",
  "The servicer update reports a different unpaid balance for these loans. Its report",
  "date is five days newer than the tape, which is the evidence a reviewer needs — but",
  "the system does not pick a winner on its own.",
  "",
  conflicted.map((id) => `\`${id}\``).join(", "),
  "",
  `## Missing documentation (${missingDocs.length})`,
  "",
  missingDocs.map((id) => `\`${id}\``).join(", "),
  "",
].join("\n");

writeFileSync(join(ROOT, "docs/defects.md"), answer);

console.log(`loan_tape.csv          ${N} rows, ${TAPE_HEADERS.length} columns`);
console.log(`servicer_update.csv    ${servicerRows.length - 1} rows (${conflicted.length} materially disagree)`);
console.log(`document_manifest.csv  ${manifestRows.length - 1} rows (${missingDocs.length} missing, ${partialDocs.length} partial)`);
console.log(`clean_tape_50.csv      50 rows`);
console.log(`defect classes planted ${byDefect.size}`);
