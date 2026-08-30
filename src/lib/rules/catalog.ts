import type { Expr } from "./dsl";
import type { CanonicalField } from "@/lib/schema/fields";

export type Severity = "BLOCKER" | "CRITICAL" | "WARNING" | "INFO";

export type RuleDef = {
  code: string;
  name: string;
  /** One plain sentence. Two readers: the analyst in the UI, and the model in the explain prompt. */
  description: string;
  category: string;
  severity: Severity;
  scope: "record" | "tape";
  field: CanonicalField | null;
  expected: string;
  expression: Expr;
  /** deterministic repair used when the model is unavailable — 9 rules have one */
  repairHint?: string;
  /**
   * Input fields this rule reasons FROM. If any of them already carries a gating
   * exception on the same record, this rule is suppressed for that record.
   *
   * Without this, one bad interest rate fires the range rule AND the amortization
   * rule, and the amortization repair then proposes a payment derived from the
   * very value that is known to be wrong. Cascades like that are how an exception
   * queue turns into noise.
   */
  dependsOn?: CanonicalField[];
};

const f = (field: CanonicalField) => ({ field });
const c = (v: number | string | null) => ({ const: v });

export const RULE_CATALOG: RuleDef[] = [
  /* ------------------------------------------------------------ structural */
  {
    code: "STR-001", name: "Missing loan identifier", category: "structural", severity: "BLOCKER",
    scope: "record", field: "loanId", expected: "a non-empty loan identifier",
    description: "Every loan must carry a unique identifier from the originator or servicer; without one the record cannot be reconciled against any other system.",
    expression: { op: "isNull", field: "loanId" },
  },
  {
    code: "STR-002", name: "Duplicate loan identifier", category: "structural", severity: "BLOCKER",
    scope: "record", field: "loanId", expected: "the identifier to appear exactly once in the tape",
    description: "A loan identifier appears more than once in this tape, which means either a genuine duplicate row or two different loans sharing an id — both corrupt every downstream aggregate.",
    expression: { op: "duplicate", field: "loanId" },
  },
  {
    code: "STR-003", name: "Duplicate borrower, principal and origination date", category: "structural", severity: "CRITICAL",
    scope: "record", field: "borrowerId", expected: "no other row with the same borrower, principal and origination date",
    description: "With no loan identifier present, the combination of borrower, original principal and origination date is the natural key; a repeated combination is almost always the same loan submitted twice.",
    expression: { op: "compoundDuplicate", fields: ["borrowerId", "originalPrincipal", "originationDate"] },
  },
  {
    code: "STR-004", name: "Source column not mapped", category: "structural", severity: "WARNING",
    scope: "tape", field: null, expected: "every source column either mapped or explicitly ignored",
    description: "A column in the uploaded file was neither mapped to a canonical field nor explicitly ignored, so the data it carries is silently absent from every check.",
    expression: { op: "rowCountZero" }, // evaluated specially by the engine at tape scope
  },

  /* --------------------------------------------------------------- format */
  {
    code: "FMT-001", name: "Origination date unparseable", category: "format", severity: "CRITICAL",
    scope: "record", field: "originationDate", expected: "a real calendar date",
    description: "The origination date arrived in a form that is not a real calendar date — an impossible day, an ambiguous ordering, or a month and year with no day.",
    expression: { op: "parseError", field: "originationDate" },
  },
  {
    code: "FMT-002", name: "Maturity date unparseable", category: "format", severity: "CRITICAL",
    scope: "record", field: "maturityDate", expected: "a real calendar date",
    description: "The maturity date arrived in a form that is not a real calendar date, so the loan's remaining term cannot be computed.",
    expression: { op: "parseError", field: "maturityDate" },
  },
  {
    code: "FMT-003", name: "Balance is not numeric", category: "format", severity: "CRITICAL",
    scope: "record", field: "currentBalance", expected: "a numeric amount",
    description: "A principal figure could not be read as a number even after stripping currency symbols, separators and accounting negatives.",
    expression: { op: "or", args: [{ op: "parseError", field: "currentBalance" }, { op: "parseError", field: "originalPrincipal" }] },
  },
  {
    code: "FMT-004", name: "Invalid state code", category: "format", severity: "WARNING",
    scope: "record", field: "borrowerState", expected: "a two-letter USPS state code",
    description: "The borrower state is not a recognised two-letter USPS code and could not be resolved from a full name or common abbreviation.",
    expression: { op: "or", args: [{ op: "parseError", field: "borrowerState" }, { op: "notIn", field: "borrowerState", ref: "usStates" }] },
    repairHint: "state.fuzzy",
  },
  {
    code: "FMT-005", name: "Malformed postal code", category: "format", severity: "WARNING",
    scope: "record", field: "borrowerZip", expected: "##### or #####-####",
    description: "The postal code is not five digits or ZIP+4; the most common cause is a spreadsheet stripping a leading zero.",
    expression: { op: "or", args: [{ op: "parseError", field: "borrowerZip" }, { op: "matches", field: "borrowerZip", pattern: "^\\d{5}(-\\d{4})?$", negate: true }] },
    repairHint: "zip.pad",
  },
  {
    code: "FMT-006", name: "Unrecognised payment status", category: "format", severity: "WARNING",
    scope: "record", field: "paymentStatus",
    expected: "one of CURRENT, DELINQUENT, DEFAULT, PAID_OFF, FORECLOSURE, UNKNOWN",
    description: "The payment status is not a value this system recognises. It is left null rather than bucketed as UNKNOWN, because UNKNOWN means the source said so — and quietly conflating the two would stop every delinquency rule applying to this loan with nothing to show for it.",
    expression: { op: "parseError", field: "paymentStatus" },
  },

  /* ---------------------------------------------------------------- range */
  {
    code: "RNG-001", name: "Credit score outside 300-850", category: "range", severity: "CRITICAL",
    scope: "record", field: "creditScore", expected: "300 to 850",
    description: "FICO scores run from 300 to 850; a value outside that band is a keying or scaling error, not a real score.",
    expression: { op: "and", args: [{ op: "notNull", field: "creditScore" }, { op: "between", field: "creditScore", min: 300, max: 850, negate: true }] },
  },
  {
    code: "RNG-002", name: "Interest rate outside plausible range", category: "range", severity: "CRITICAL",
    scope: "record", field: "interestRate", expected: "0% to 25%",
    description: "The annual rate falls outside 0 to 25 percent, which usually means the column mixed decimal form with percent form.",
    expression: { op: "and", args: [{ op: "notNull", field: "interestRate" }, { op: "between", field: "interestRate", min: 0, max: 25, negate: true }] },
    repairHint: "rate.rescale",
  },
  {
    code: "RNG-003", name: "Term outside 1-480 months", category: "range", severity: "CRITICAL",
    scope: "record", field: "termMonths", expected: "1 to 480 months",
    description: "A loan term below one month or above forty years is not a real amortization schedule.",
    expression: { op: "and", args: [{ op: "notNull", field: "termMonths" }, { op: "between", field: "termMonths", min: 1, max: 480, negate: true }] },
    repairHint: "term.fromDates",
  },
  {
    code: "RNG-004", name: "Negative principal or balance", category: "range", severity: "BLOCKER",
    scope: "record", field: "currentBalance", expected: "zero or greater",
    description: "Principal amounts cannot be negative; a negative balance is either a sign convention leaking in from an accounting export or a corrupted value.",
    expression: { op: "or", args: [
      { op: "cmp", left: f("currentBalance"), cmp: "lt", right: c(0) },
      { op: "cmp", left: f("originalPrincipal"), cmp: "lt", right: c(0) },
    ] },
    repairHint: "abs",
  },
  {
    code: "RNG-005", name: "Days past due implausible", category: "range", severity: "WARNING",
    scope: "record", field: "daysPastDue", expected: "0 to 3650",
    description: "Days past due is negative or exceeds ten years, which no servicing system produces for a live loan.",
    expression: { op: "and", args: [{ op: "notNull", field: "daysPastDue" }, { op: "between", field: "daysPastDue", min: 0, max: 3650, negate: true }] },
  },

  /* ----------------------------------------------------------- cross-field */
  {
    code: "XFD-001", name: "Current balance exceeds original principal", category: "cross_field", severity: "CRITICAL",
    scope: "record", field: "currentBalance", expected: "at or below the original principal",
    description: "The outstanding balance is above the amount originally funded, which is impossible for an amortizing loan unless negative amortization applies — and it does not for this product.",
    expression: { op: "cmp", left: f("currentBalance"), cmp: "gt", right: { calc: "mul", args: [f("originalPrincipal"), c(1.001)] } },
    dependsOn: ["currentBalance", "originalPrincipal"],
    repairHint: "balance.clampToOriginal",
  },
  {
    code: "XFD-002", name: "Maturity on or before origination", category: "cross_field", severity: "BLOCKER",
    scope: "record", field: "maturityDate", expected: "a maturity date after the origination date",
    description: "The loan matures on or before the day it was funded, so the two dates are transposed or one of them was read in the wrong day-month order.",
    expression: { op: "cmp", left: f("maturityDate"), cmp: "lte", right: f("originationDate") },
    dependsOn: ["originationDate", "maturityDate"],
    repairHint: "dates.swapOrReparse",
  },
  {
    code: "XFD-003", name: "Payment does not amortize", category: "cross_field", severity: "CRITICAL",
    scope: "record", field: "paymentAmount", expected: "within 2% of the amortizing payment",
    description: "The scheduled payment should amortize the original principal over the stated term at the stated rate; a gap above two percent usually means the rate, the term or the payment was keyed wrong.",
    expression: { op: "and", args: [
      { op: "notNull", field: "paymentAmount" },
      { op: "cmp",
        left: { calc: "div", args: [{ fn: "abs", args: [{ calc: "sub", args: [f("paymentAmount"), { fn: "amortPayment" }] }] }, { fn: "amortPayment" }] },
        cmp: "gt", right: c(0.02) },
    ] },
    dependsOn: ["originalPrincipal", "interestRate", "termMonths", "paymentAmount"],
    repairHint: "payment.amortizing",
  },
  {
    code: "XFD-004", name: "Delinquency conflicts with payment status", category: "cross_field", severity: "CRITICAL",
    scope: "record", field: "paymentStatus", expected: "a delinquent status when days past due is above zero",
    description: "The loan is marked current while carrying days past due above zero; one of the two fields is stale, and reporting the loan as current understates portfolio risk.",
    expression: { op: "and", args: [
      { op: "cmp", left: f("daysPastDue"), cmp: "gt", right: c(0) },
      { op: "cmp", left: f("paymentStatus"), cmp: "eq", right: c("CURRENT") },
    ] },
    dependsOn: ["daysPastDue", "paymentStatus"],
    repairHint: "status.fromDpd",
  },
  {
    code: "XFD-005", name: "Paid off but balance remains", category: "cross_field", severity: "CRITICAL",
    scope: "record", field: "currentBalance", expected: "a zero balance on a paid-off loan",
    description: "The loan is marked paid off yet still reports a positive outstanding balance, so either the payoff was not applied or the status was set early.",
    expression: { op: "and", args: [
      { op: "cmp", left: f("paymentStatus"), cmp: "eq", right: c("PAID_OFF") },
      { op: "cmp", left: f("currentBalance"), cmp: "gt", right: c(0) },
    ] },
    dependsOn: ["paymentStatus", "currentBalance"],
    repairHint: "balance.zeroOnPayoff",
  },
  {
    code: "XFD-006", name: "Term inconsistent with the dates", category: "cross_field", severity: "WARNING",
    scope: "record", field: "termMonths", expected: "within 2 months of the gap between origination and maturity",
    description: "The stated term does not match the distance between origination and maturity, which points at a mis-parsed date or a term copied from a different loan.",
    expression: { op: "cmp",
      left: { fn: "abs", args: [{ calc: "sub", args: [{ fn: "monthsBetween", args: [f("originationDate"), f("maturityDate")] }, f("termMonths")] }] },
      cmp: "gt", right: c(2) },
    dependsOn: ["originationDate", "maturityDate", "termMonths"],
  },

  /* ---------------------------------------------------------- consistency */
  {
    code: "CON-001", name: "Sources disagree on this field", category: "consistency", severity: "CRITICAL",
    scope: "record", field: "currentBalance", expected: "the loan tape and the servicer update to agree",
    description: "The primary loan tape and the servicer update report different values for this loan; the system does not pick a winner on its own, because choosing silently is how bad data becomes verified data.",
    expression: { op: "conflict" },
    repairHint: "conflict.adoptNewer",
  },
  {
    code: "CON-002", name: "Unknown servicer", category: "consistency", severity: "WARNING",
    scope: "record", field: "servicerId", expected: "a servicer present in the reference list",
    description: "The servicer identifier is not in the approved servicer reference list, so payment data for this loan cannot be attributed to a known counterparty.",
    expression: { op: "notIn", field: "servicerId", ref: "servicers" },
  },
  {
    code: "CON-003", name: "Loan documentation missing", category: "consistency", severity: "CRITICAL",
    scope: "record", field: "documentStatus", expected: "documentation present in the manifest",
    description: "The document manifest reports no promissory note or security instrument on file for this loan, so the asset cannot be evidenced even if every number is correct.",
    expression: { op: "cmp", left: f("documentStatus"), cmp: "eq", right: c("MISSING") },
  },

  /* ------------------------------------------------------------ staleness */
  {
    code: "STL-001", name: "Record not updated within the reporting period", category: "staleness", severity: "WARNING",
    scope: "record", field: "lastUpdatedAt", expected: "updated within 95 days of the reporting date",
    description: "This record has not been refreshed within the reporting period, so its balance and delinquency figures describe a loan as it was, not as it is.",
    expression: { op: "stale", field: "lastUpdatedAt", days: 95 },
    dependsOn: ["lastUpdatedAt"],
  },

  /* ---------------------------------------------------------- statistical */
  {
    code: "STA-001", name: "Interest rate is an outlier", category: "statistical", severity: "WARNING",
    scope: "record", field: "interestRate", expected: "within 3.5 standard deviations of the portfolio mean",
    description: "The rate sits more than three and a half standard deviations from the mean of this tape; that is rarely fraud and often a decimal point in the wrong place.",
    expression: { op: "zscore", field: "interestRate", gt: 3.5 },
    dependsOn: ["interestRate"],
  },
  {
    code: "STA-002", name: "Placeholder origination date", category: "statistical", severity: "WARNING",
    scope: "record", field: "originationDate", expected: "a real origination date",
    description: "The origination date is a well-known placeholder that legacy systems write when the true date is unknown, so it should not be treated as a real date.",
    expression: { op: "in", field: "originationDate", values: ["1900-01-01", "1970-01-01", "0001-01-01", "1899-12-30"] },
    dependsOn: ["originationDate"],
    repairHint: "date.clearPlaceholder",
  },

  /* --------------------------------------------------------- completeness */
  {
    code: "CMP-001", name: "Credit score empty across too much of the tape", category: "completeness", severity: "WARNING",
    scope: "tape", field: "creditScore", expected: "populated in at least 80% of rows",
    description: "Credit score is empty in more than a fifth of the tape, which is a file-level gap rather than a set of individual mistakes and should be raised with the originator.",
    expression: { op: "nullRate", field: "creditScore", gt: 0.2 },
  },
  {
    code: "CMP-002", name: "Tape contains no rows", category: "completeness", severity: "BLOCKER",
    scope: "tape", field: null, expected: "at least one parseable row",
    description: "The upload produced no usable rows at all, which usually means the wrong file or an unreadable export.",
    expression: { op: "rowCountZero" },
  },
];

export const RULE_BY_CODE = new Map(RULE_CATALOG.map((r) => [r.code, r]));
export const CATEGORY_LABEL: Record<string, string> = {
  structural: "Structural", format: "Type & format", range: "Range",
  cross_field: "Cross-field", consistency: "Consistency", staleness: "Staleness",
  statistical: "Statistical", completeness: "Completeness",
};
