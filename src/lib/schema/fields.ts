/** The canonical loan schema — the single internal truth every source is mapped onto. */

export const CANONICAL_FIELDS = [
  "loanId", "borrowerId", "loanType", "loanPurpose", "originationDate", "maturityDate",
  "originalPrincipal", "currentBalance", "interestRate", "termMonths",
  "paymentAmount", "paymentStatus", "daysPastDue", "lastPaymentDate",
  "borrowerState", "borrowerZip", "creditScore", "creditGrade",
  "employmentLength", "incomeBand", "appraisedValue",
  "servicerId", "servicerName", "lastUpdatedAt", "documentStatus", "sourceSystem",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export type FieldKind = "string" | "int" | "money" | "rate" | "date" | "timestamp" | "enum" | "state" | "zip";

export const FIELD_META: Record<CanonicalField, {
  kind: FieldKind; label: string; required: boolean; scale?: number; values?: string[];
}> = {
  loanId:            { kind: "string",    label: "Loan ID",            required: true },
  borrowerId:        { kind: "string",    label: "Borrower ID",        required: false },
  loanType:          { kind: "enum",      label: "Loan type",          required: false, values: ["FIXED","ARM","HELOC","AUTO","PERSONAL","OTHER"] },
  loanPurpose:       { kind: "string",    label: "Loan purpose",       required: false },
  originationDate:   { kind: "date",      label: "Origination date",   required: true },
  maturityDate:      { kind: "date",      label: "Maturity date",      required: true },
  originalPrincipal: { kind: "money",     label: "Original principal", required: true, scale: 2 },
  currentBalance:    { kind: "money",     label: "Current balance",    required: true, scale: 2 },
  interestRate:      { kind: "rate",      label: "Interest rate",      required: true, scale: 4 },
  termMonths:        { kind: "int",       label: "Term (months)",      required: true },
  paymentAmount:     { kind: "money",     label: "Payment amount",     required: false, scale: 2 },
  paymentStatus:     { kind: "enum",      label: "Payment status",     required: false, values: ["CURRENT","DELINQUENT","DEFAULT","PAID_OFF","FORECLOSURE","UNKNOWN"] },
  daysPastDue:       { kind: "int",       label: "Days past due",      required: false },
  lastPaymentDate:   { kind: "date",      label: "Last payment date",  required: false },
  borrowerState:     { kind: "state",     label: "Borrower state",     required: false },
  borrowerZip:       { kind: "zip",       label: "Borrower ZIP",       required: false },
  creditScore:       { kind: "int",       label: "Credit score",       required: false },
  creditGrade:       { kind: "string",    label: "Credit grade",       required: false },
  employmentLength:  { kind: "string",    label: "Employment length",  required: false },
  incomeBand:        { kind: "string",    label: "Income band",        required: false },
  appraisedValue:    { kind: "money",     label: "Appraised value",    required: false, scale: 2 },
  servicerId:        { kind: "string",    label: "Servicer ID",        required: false },
  servicerName:      { kind: "string",    label: "Servicer name",      required: false },
  lastUpdatedAt:     { kind: "timestamp", label: "Last updated",       required: false },
  documentStatus:    { kind: "enum",      label: "Document status",    required: false, values: ["COMPLETE","PARTIAL","MISSING","UNKNOWN"] },
  sourceSystem:      { kind: "string",    label: "Source system",      required: false },
};

/**
 * Alias dictionary — pass 2 of header matching. Written by hand from the header
 * variants loan tapes actually arrive with. Extend it whenever a new one shows up;
 * it is cheaper and more predictable than widening the fuzzy matcher.
 */
export const ALIASES: Record<CanonicalField, string[]> = {
  loanId:            ["loan id","loan no","loan number","loan_no","loan_num","acct","account","account id","id","loan ref","loan_ref","asset id"],
  borrowerId:        ["borrower id","borrower","obligor","obligor id","customer id","cust id","borrower no","borrower_ref"],
  loanType:          ["type","product","loan product","product type","loan type","asset type","instrument"],
  loanPurpose:       ["purpose","loan purpose","use of proceeds","purpose code","loan use"],
  originationDate:   ["orig date","orig dt","origination","origination date","start date","funded date","note date","closing date","orig_dt","first pay date"],
  maturityDate:      ["maturity","mat date","mat dt","maturity date","end date","final payment date","maturity dt","payoff date"],
  originalPrincipal: ["orig bal","orig balance","original balance","original amount","note amount","original principal","orig principal","orig amt","original upb","face amount"],
  currentBalance:    ["curr bal","current bal","upb","unpaid principal balance","principal balance","outstanding","outstanding balance","prin balance","current balance","ending balance","current upb"],
  interestRate:      ["rate","int rate","interest","coupon","apr","note rate","interest rate","gross rate","current rate"],
  termMonths:        ["term","term months","term (months)","amort term","months","original term","loan term","remaining term"],
  paymentAmount:     ["payment","monthly payment","p&i","pi","pmt","scheduled payment","payment amount","monthly p&i","installment"],
  paymentStatus:     ["status","payment status","loan status","delinquency status","perf status","performance"],
  daysPastDue:       ["dpd","days past due","days delinquent","delinquency days","past due days","days late"],
  lastPaymentDate:   ["last payment date","last paid","last pmt date","last payment","date last paid","lpd"],
  borrowerState:     ["state","st","property state","borrower state","prop st","state code","state cd"],
  borrowerZip:       ["zip","zip code","postal","postal code","property zip","borrower zip","zipcode"],
  creditScore:       ["fico","credit score","score","fico score","borrower fico","credit bureau score","representative fico"],
  creditGrade:       ["grade","credit grade","risk grade","internal grade","rating","credit tier","tier"],
  employmentLength:  ["employment length","emp length","years employed","employment","job tenure","time in job"],
  incomeBand:        ["income band","income bracket","income range","income tier","annual income band","income"],
  appraisedValue:    ["appraisal","appraised","appraised value","value","property value","av","collateral value"],
  servicerId:        ["servicer id","sub servicer","subservicer","svcr","servicer code","seller servicer","svcr id"],
  servicerName:      ["servicer","servicer name","servicer nm","subservicer name","svcr name","serviced by"],
  lastUpdatedAt:     ["last updated","updated","as of","as of date","report date","last update","record date","file date"],
  documentStatus:    ["doc status","document status","docs","documentation","doc availability","collateral docs"],
  sourceSystem:      ["source system","source","system","origin system","system of record","src","feed"],
};

/** header -> canonical, built once */
export const ALIAS_INDEX: Map<string, CanonicalField> = (() => {
  const m = new Map<string, CanonicalField>();
  for (const f of CANONICAL_FIELDS) {
    m.set(normalizeHeader(f), f);
    for (const a of ALIASES[f]) m.set(normalizeHeader(a), f);
  }
  return m;
})();

export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, " ")
    .replace(/[^a-z0-9& ]/g, "")
    .trim();
}
