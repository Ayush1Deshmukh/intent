import { describe, it, expect } from "vitest";
import { ALL_ACTIONS, ALL_ROLES, can, POLICY } from "@/lib/policy";

describe("policy — every role x every action", () => {
  it("covers 3 roles x 15 actions", () => {
    expect(ALL_ROLES).toHaveLength(3);
    expect(ALL_ACTIONS).toHaveLength(15);
  });

  it("the data consumer has no write capability at all", () => {
    const writes = ALL_ACTIONS.filter((a) => !/(:read|verify:run|export:generate)$/.test(a));
    for (const a of writes) {
      expect(can("DATA_CONSUMER", a), `consumer must not be able to ${a}`).toBe(false);
    }
  });

  it("the maker cannot approve, and the checker cannot make", () => {
    expect(can("DATA_OPERATOR", "proposal:accept")).toBe(true);
    expect(can("DATA_OPERATOR", "proposal:approve")).toBe(false);
    expect(can("DATA_OPERATOR", "tape:attest")).toBe(false);
    expect(can("REVIEWER", "proposal:approve")).toBe(true);
    expect(can("REVIEWER", "proposal:accept")).toBe(false);
    expect(can("REVIEWER", "tape:upload")).toBe(false);
  });

  it("only the reviewer can drop a loan from the tape", () => {
    // The escape hatch for a blocker with no defensible repair. It has to sit on the
    // checker side: an operator who could both propose a value and delete the loan
    // when the value is refused has, between those two, an unreviewed write path.
    expect(can("REVIEWER", "loan:exclude")).toBe(true);
    expect(can("DATA_OPERATOR", "loan:exclude")).toBe(false);
    expect(can("DATA_CONSUMER", "loan:exclude")).toBe(false);
  });

  it("everyone can read, verify and export", () => {
    for (const r of ALL_ROLES) {
      expect(can(r, "tape:read")).toBe(true);
      expect(can(r, "audit:read")).toBe(true);
      expect(can(r, "verify:run")).toBe(true);
      expect(can(r, "export:generate")).toBe(true);
    }
  });

  it("no action is unreachable by every role", () => {
    for (const a of ALL_ACTIONS) expect(POLICY[a].length, a).toBeGreaterThan(0);
  });

  it("the full 45-cell matrix is explicit", () => {
    const cells = ALL_ROLES.flatMap((r) => ALL_ACTIONS.map((a) => `${r}:${a}:${can(r, a)}`));
    expect(cells).toHaveLength(45);
    expect(new Set(cells).size).toBe(45);
  });
});
