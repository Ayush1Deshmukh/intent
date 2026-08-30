import { describe, it, expect } from "vitest";
import { RULE_CATALOG, RULE_BY_CODE } from "@/lib/rules/catalog";
import { runRules, EngineRecord, computeStats } from "@/lib/rules/engine";
import { amortPayment } from "@/lib/rules/dsl";

const SERVICERS = new Set(["SVC-01", "SVC-02"]);
const AS_OF = "2026-08-01";

function base(overrides: Partial<EngineRecord["values"]> = {}, id = "r1"): EngineRecord {
  const values = {
    loanId: "LN-000001", borrowerId: "B-0001", loanType: "FIXED",
    originationDate: "2020-01-15", maturityDate: "2050-01-15",
    originalPrincipal: "400000.00", currentBalance: "350000.00",
    interestRate: "5.5000", termMonths: 360,
    paymentAmount: null as string | null,
    paymentStatus: "CURRENT", daysPastDue: 0,
    borrowerState: "CA", borrowerZip: "90210", creditScore: 720,
    appraisedValue: "500000.00", servicerId: "SVC-01",
    lastUpdatedAt: "2026-07-01T00:00:00.000Z", documentStatus: "COMPLETE",
    ...overrides,
  };
  if (values.paymentAmount === null) {
    const p = amortPayment({
      record: values, errors: {}, conflicts: {},
      stats: computeStats([]), refs: { usStates: new Set(["CA"]), servicers: SERVICERS }, asOf: AS_OF,
    });
    values.paymentAmount = p ? p.toFixed(2) : null;
  }
  return { id, loanId: values.loanId as string, values, errors: {}, conflicts: {} };
}

function fire(recs: EngineRecord[], unmapped: string[] = []) {
  return runRules(recs, RULE_CATALOG, { servicers: SERVICERS, asOf: AS_OF, unmappedHeaders: unmapped })
    .map((e) => e.ruleCode);
}

describe("the clean canary", () => {
  it("a well-formed record fires nothing", () => {
    // creditScore present on the only row, so CMP-001 must not fire either
    expect(fire([base()])).toEqual([]);
  });
});

describe("structural", () => {
  it("STR-001 missing loan id", () => expect(fire([base({ loanId: null })])).toContain("STR-001"));
  it("STR-002 duplicate loan id", () => {
    const codes = fire([base({}, "a"), base({}, "b")]);
    expect(codes.filter((c) => c === "STR-002")).toHaveLength(2);
  });
  it("STR-003 compound duplicate when the id is missing", () => {
    const codes = fire([base({ loanId: null }, "a"), base({ loanId: null }, "b")]);
    expect(codes).toContain("STR-003");
  });
  it("STR-004 unmapped source column", () => expect(fire([base()], ["Notes"])).toContain("STR-004"));
});

describe("format", () => {
  const withErr = (field: string, msg: string) => {
    const r = base(); (r.errors as Record<string, string>)[field] = msg; (r.values as Record<string, unknown>)[field] = null; return r;
  };
  it("FMT-001", () => expect(fire([withErr("originationDate", 'impossible date "31/02/2024"')])).toContain("FMT-001"));
  it("FMT-002", () => expect(fire([withErr("maturityDate", "unparseable")])).toContain("FMT-002"));
  it("FMT-003", () => expect(fire([withErr("currentBalance", "not a number")])).toContain("FMT-003"));
  it("FMT-004 invalid state", () => expect(fire([base({ borrowerState: "XX" })])).toContain("FMT-004"));
  it("FMT-005 malformed zip", () => expect(fire([base({ borrowerZip: "9021" })])).toContain("FMT-005"));
  it("FMT-006 unrecognised payment status", () =>
    expect(fire([withErr("paymentStatus", 'unrecognised payment_status "In Repayment"')])).toContain("FMT-006"));
  it("FMT-006 accepts every documented status", () => {
    for (const ok of ["CURRENT", "DELINQUENT", "DEFAULT", "PAID_OFF", "FORECLOSURE", "UNKNOWN"]) {
      expect(fire([base({ paymentStatus: ok })]), ok).not.toContain("FMT-006");
    }
  });
});

describe("range", () => {
  it("RNG-001 fico high", () => expect(fire([base({ creditScore: 8500 })])).toContain("RNG-001"));
  it("RNG-001 fico low", () => expect(fire([base({ creditScore: 250 })])).toContain("RNG-001"));
  it("RNG-002 rate", () => expect(fire([base({ interestRate: "55.0000" })])).toContain("RNG-002"));
  it("RNG-003 term", () => expect(fire([base({ termMonths: 900 })])).toContain("RNG-003"));
  it("RNG-004 negative balance", () => expect(fire([base({ currentBalance: "-100.00" })])).toContain("RNG-004"));
  it("RNG-005 dpd", () => expect(fire([base({ daysPastDue: -5 })])).toContain("RNG-005"));
});

describe("cross-field", () => {
  it("XFD-001 balance over principal", () => expect(fire([base({ currentBalance: "410000.00" })])).toContain("XFD-001"));
  it("XFD-002 maturity before origination", () => expect(fire([base({ maturityDate: "2019-01-15" })])).toContain("XFD-002"));
  it("XFD-003 payment does not amortize", () => expect(fire([base({ paymentAmount: "3500.00" })])).toContain("XFD-003"));
  it("XFD-004 dpd vs status", () => expect(fire([base({ daysPastDue: 45 })])).toContain("XFD-004"));
  it("XFD-005 paid off with balance", () => expect(fire([base({ paymentStatus: "PAID_OFF" })])).toContain("XFD-005"));
  it("XFD-006 term vs dates", () => expect(fire([base({ termMonths: 180 })])).toContain("XFD-006"));
});

describe("consistency, staleness, statistical, completeness", () => {
  it("CON-001 source conflict", () => {
    const r = base();
    r.conflicts = { currentBalance: { primary: "350000.00", secondary: "348500.00", source: "servicer update" } };
    expect(fire([r])).toContain("CON-001");
  });
  it("CON-002 unknown servicer", () => expect(fire([base({ servicerId: "SVC-99" })])).toContain("CON-002"));
  it("CON-003 missing documentation", () => expect(fire([base({ documentStatus: "MISSING" })])).toContain("CON-003"));
  it("STL-001 stale record", () => expect(fire([base({ lastUpdatedAt: "2025-01-01T00:00:00.000Z" })])).toContain("STL-001"));
  it("STA-001 rate outlier", () => {
    const recs = [...Array(40)].map((_, i) => base({ interestRate: "5.5000" }, `n${i}`));
    recs.push(base({ interestRate: "19.7500", loanId: "LN-OUT" }, "out"));
    expect(fire(recs)).toContain("STA-001");
  });
  it("STA-002 placeholder date", () => expect(fire([base({ originationDate: "1900-01-01" })])).toContain("STA-002"));
  it("CMP-001 null rate over threshold", () => {
    const recs = [base({ creditScore: null }, "a"), base({ creditScore: null }, "b"), base({}, "c")];
    expect(fire(recs)).toContain("CMP-001");
  });
  it("CMP-002 empty tape", () => expect(fire([])).toContain("CMP-002"));
});

describe("null safety — the rule that stops the exception count exploding", () => {
  it("a record with every optional field empty fires only the missing-value rules", () => {
    const r = base({
      creditScore: null, daysPastDue: null, borrowerState: null, borrowerZip: null,
      interestRate: null, termMonths: null, paymentAmount: null, currentBalance: null,
      originalPrincipal: null, servicerId: null, documentStatus: null,
      lastUpdatedAt: null, paymentStatus: null, appraisedValue: null,
    });
    r.values.paymentAmount = null;
    const codes = fire([r]);
    for (const c of ["RNG-001","RNG-002","RNG-003","RNG-004","RNG-005","XFD-001","XFD-003","XFD-004","XFD-005","FMT-004","FMT-005","CON-002","CON-003","STL-001","STA-001"]) {
      expect(codes, `${c} must not fire on a null value`).not.toContain(c);
    }
  });
});

describe("catalog integrity", () => {
  it("every rule has a unique code, a description and an expected", () => {
    const codes = new Set(RULE_CATALOG.map((r) => r.code));
    expect(codes.size).toBe(RULE_CATALOG.length);
    for (const r of RULE_CATALOG) {
      expect(r.description.length, r.code).toBeGreaterThan(40);
      expect(r.expected.length, r.code).toBeGreaterThan(3);
    }
  });
  it("has 29 rules across 8 families", () => {
    expect(RULE_CATALOG).toHaveLength(29);
    expect(new Set(RULE_CATALOG.map((r) => r.category)).size).toBe(8);
  });
  it("every rule in the catalog is reachable by code", () => {
    for (const r of RULE_CATALOG) expect(RULE_BY_CODE.get(r.code)).toBe(r);
  });
});
