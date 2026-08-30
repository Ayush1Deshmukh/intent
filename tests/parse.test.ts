import { describe, expect, it } from "vitest";
import { parseBuffer } from "@/lib/ingest/parse";

/**
 * A row the parser cannot read must be *reported*, not dropped.
 *
 * This exists because it was dropped: `parseBuffer` collected bad rows into `badRows`
 * and the ingest service never read the list, so a malformed line vanished, the row
 * count was simply smaller, and nothing anywhere said a row had been lost. For a system
 * whose subject is data you are supposed to be able to trust, silently losing input is
 * the worst failure available to it.
 */
describe("parsing keeps what it cannot read", () => {
  const csv = (s: string) => parseBuffer("t.csv", Buffer.from(s, "utf8"));

  it("reads a well-formed file and finds nothing bad", () => {
    const r = csv("a,b\n1,2\n3,4\n");
    expect(r.rows).toHaveLength(2);
    expect(r.badRows).toHaveLength(0);
    expect(r.headers).toEqual(["a", "b"]);
  });

  it("reports a row with too many fields rather than discarding it", () => {
    const r = csv("a,b\n1,2\n3,4,5\n6,7\n");
    expect(r.badRows.length, "the malformed row must be reported").toBeGreaterThan(0);
    expect(r.badRows[0].rowNumber, "and must say which line it was").toBeGreaterThan(1);
    expect(r.badRows[0].error).toMatch(/./);
  });

  it("strips a UTF-8 BOM from the first header rather than mangling it", () => {
    const r = csv("\ufeffLoan No,Balance\nLN-1,100\n");
    expect(r.headers[0]).toBe("Loan No");
  });

  it("skips blank lines without counting them as failures", () => {
    const r = csv("a,b\n1,2\n\n\n3,4\n");
    expect(r.rows).toHaveLength(2);
    expect(r.badRows).toHaveLength(0);
  });

  it("hashes the file, so the same bytes always identify the same source", () => {
    expect(csv("a,b\n1,2\n").sha256).toBe(csv("a,b\n1,2\n").sha256);
    expect(csv("a,b\n1,2\n").sha256).not.toBe(csv("a,b\n1,3\n").sha256);
  });
});
