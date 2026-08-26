import { describe, it, expect } from "vitest";
import { canonicalJson, fixed, dateOnly } from "@/lib/canonical";
import { recordHash, eventHash, merkleRoot, merkleProof, verifyMerkleProof, sha256, GENESIS } from "@/lib/hash";

const rec = {
  id: "abc", version: 1, loanId: "LN-1", borrowerId: "B-1", loanType: "FIXED",
  originationDate: "2020-01-15", maturityDate: "2050-01-15",
  originalPrincipal: "400000.00", currentBalance: "350000.00", interestRate: "5.5000",
  termMonths: 360, paymentAmount: "2271.16", paymentStatus: "CURRENT", daysPastDue: 0,
  borrowerState: "CA", borrowerZip: "90210", creditScore: 720,
  appraisedValue: "500000.00", servicerId: "SVC-01",
  lastUpdatedAt: "2026-07-01T00:00:00.000Z", documentStatus: "COMPLETE",
};

describe("canonicalJson", () => {
  it("sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("emits null explicitly so missing and null hash differently", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(sha256(canonicalJson({ a: null }))).not.toBe(sha256(canonicalJson({})));
  });
  it("serializes floats deterministically for event payloads", () => {
    expect(canonicalJson({ confidence: 0.95 })).toBe('{"confidence":0.95}');
    // faithful, not rounded: the classic float artefact must survive as itself
    expect(canonicalJson(0.1 + 0.2)).not.toBe(canonicalJson(0.3));
  });
  it("refuses non-finite numbers", () => {
    expect(() => canonicalJson({ x: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalJson({ x: NaN })).toThrow(/non-finite/);
  });
  it("money never reaches the hasher as a float — businessFields fixes the scale", () => {
    // this is the invariant that the float rule above depends on
    expect(fixed(1000, 2)).toBe("1000.00");
    expect(recordHash({ ...rec, currentBalance: 350000 })).toBe(recordHash({ ...rec, currentBalance: "350000.00" }));
  });
  it("normalizes and trims strings", () => {
    expect(canonicalJson("  hi  ")).toBe('"hi"');
  });
  it("formats decimals at a declared scale", () => {
    expect(fixed("1000", 2)).toBe("1000.00");
    expect(fixed(5.5, 4)).toBe("5.5000");
    expect(fixed(null, 2)).toBeNull();
  });
  it("reduces dates to YYYY-MM-DD", () => {
    expect(dateOnly("2020-01-15T00:00:00.000Z")).toBe("2020-01-15");
  });
});

describe("recordHash", () => {
  it("is deterministic", () => expect(recordHash(rec)).toBe(recordHash(rec)));
  it("is independent of key order", () => {
    const shuffled = Object.fromEntries(Object.entries(rec).reverse());
    expect(recordHash(shuffled)).toBe(recordHash(rec));
  });
  it("changes when any business field changes", () => {
    expect(recordHash({ ...rec, currentBalance: "350000.01" })).not.toBe(recordHash(rec));
  });
  it("changes when the version changes", () => {
    expect(recordHash({ ...rec, version: 2 })).not.toBe(recordHash(rec));
  });
  it("ignores fields outside the business set", () => {
    expect(recordHash({ ...rec, someInternalColumn: "whatever" })).toBe(recordHash(rec));
  });
  it("treats 1000 and 1000.00 as the same value", () => {
    expect(recordHash({ ...rec, currentBalance: "350000" })).toBe(recordHash(rec));
  });
});

describe("event chain", () => {
  const mk = (seq: number) => ({
    seq, createdAt: "2026-08-01T10:00:00.000Z", actorId: "u1", actorRole: "REVIEWER",
    action: "CHANGE_APPROVED", entityType: "loanRecord", entityId: "abc", payload: { field: "currentBalance" },
  });
  it("links each event to the previous hash", () => {
    const h1 = eventHash(GENESIS, mk(1));
    const h2 = eventHash(h1, mk(2));
    const h2Forged = eventHash(GENESIS, mk(2));
    expect(h2).not.toBe(h2Forged);
  });
  it("breaks every downstream link when an old event is altered", () => {
    const h1 = eventHash(GENESIS, mk(1));
    const h2 = eventHash(h1, mk(2));
    const tampered = { ...mk(1), payload: { field: "interestRate" } };
    const h1b = eventHash(GENESIS, tampered);
    expect(h1b).not.toBe(h1);
    expect(eventHash(h1b, mk(2))).not.toBe(h2);
  });
});

describe("merkle", () => {
  const leaves = ["aa", "bb", "cc", "dd", "ee"].map((s) => sha256(s));
  it("is stable regardless of input order", () => {
    expect(merkleRoot(leaves)).toBe(merkleRoot([...leaves].reverse()));
  });
  it("changes when any leaf changes", () => {
    const changed = [...leaves]; changed[2] = sha256("cc-tampered");
    expect(merkleRoot(changed)).not.toBe(merkleRoot(leaves));
  });
  it("returns the genesis value for an empty set", () => expect(merkleRoot([])).toBe(GENESIS));
  it("promotes an odd node rather than duplicating it", () => {
    // a duplicated odd node would make a 3-leaf tree equal a 4-leaf tree ending in a repeat
    const three = leaves.slice(0, 3);
    const dupd = [...three, three[three.length - 1]];
    expect(merkleRoot(three)).not.toBe(merkleRoot(dupd));
  });
  it("produces a proof a consumer can verify offline", () => {
    const root = merkleRoot(leaves);
    for (const leaf of leaves) {
      expect(verifyMerkleProof(leaf, merkleProof(leaves, leaf), root)).toBe(true);
    }
    expect(verifyMerkleProof(sha256("nope"), merkleProof(leaves, leaves[0]), root)).toBe(false);
  });
});

describe("tamper detection end to end", () => {
  it("a single edited balance moves the root and names the divergent leaf", () => {
    const records = [rec, { ...rec, id: "def", loanId: "LN-2" }, { ...rec, id: "ghi", loanId: "LN-3" }];
    const before = records.map((r) => ({ loanId: r.loanId, hash: recordHash(r) }));
    const attested = merkleRoot(before.map((l) => l.hash));

    // someone edits the database directly, bypassing the application
    const after = records.map((r) =>
      r.id === "def" ? { loanId: r.loanId, hash: recordHash({ ...r, currentBalance: "1.00" }) }
                     : { loanId: r.loanId, hash: recordHash(r) });

    expect(merkleRoot(after.map((l) => l.hash))).not.toBe(attested);
    const first = after.find((l, i) => l.hash !== before[i].hash);
    expect(first?.loanId).toBe("LN-2");
  });
});
