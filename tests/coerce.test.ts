import { describe, it, expect } from "vitest";
import { coerceDate, detectDateFormat, excelSerialToIso } from "@/lib/coerce/date";
import { coerceMoney } from "@/lib/coerce/money";
import { coerceRate, detectRateScale } from "@/lib/coerce/rate";
import { coerceState } from "@/lib/coerce/state";
import { coerceZip, coerceInt, coerceText, coerceTimestamp, coercePaymentStatus } from "@/lib/coerce/misc";

describe("dates", () => {
  it("parses ISO", () => expect(coerceDate("2024-03-31").value).toBe("2024-03-31"));

  it("REFUSES an impossible date instead of silently sliding it", () => {
    const r = coerceDate("31/02/2024", "dmy");
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
  });

  it("uses the column hint so one column parses one way", () => {
    expect(coerceDate("03/04/2024", "mdy").value).toBe("2024-03-04");
    expect(coerceDate("03/04/2024", "dmy").value).toBe("2024-04-03");
  });

  it("flags a value that is only valid in the other ordering", () => {
    const r = coerceDate("13/07/2024", "mdy");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ambiguous/);
  });

  it("converts Excel serials", () => {
    // 44927 = 2023-01-01, so 45012 = +85 days = 2023-03-27
    expect(excelSerialToIso(45012)).toBe("2023-03-27");
    expect(excelSerialToIso(44927)).toBe("2023-01-01");
    expect(coerceDate("45012").coercion).toBe("date.excel");
  });

  it("parses compact and long forms", () => {
    expect(coerceDate("20240331").value).toBe("2024-03-31");
    expect(coerceDate("Mar 31, 2024").value).toBe("2024-03-31");
    expect(coerceDate("31 March 2024").value).toBe("2024-03-31");
  });

  it("rejects month-year only", () => expect(coerceDate("04-2025").ok).toBe(false));

  it("detects column format from the whole column", () => {
    expect(detectDateFormat(["01/02/2024", "31/03/2024"])).toBe("dmy");
    expect(detectDateFormat(["01/02/2024", "03/31/2024"])).toBe("mdy");
    expect(detectDateFormat(["31/03/2024", "03/31/2024"])).toBe("mixed");
  });
});

describe("money", () => {
  it("strips symbols and separators", () => expect(coerceMoney("$412,000.00").value).toBe("412000.00"));
  it("handles accounting negatives", () => expect(coerceMoney("(1,234.56)").value).toBe("-1234.56"));
  it("handles european decimals", () => expect(coerceMoney("1.234,56").value).toBe("1234.56"));
  it("handles trailing minus", () => expect(coerceMoney("500.00-").value).toBe("-500.00"));
  it("returns null for blanks and n/a", () => {
    expect(coerceMoney("").value).toBeNull();
    expect(coerceMoney("N/A").value).toBeNull();
  });
  it("fails loudly on text", () => expect(coerceMoney("see note").ok).toBe(false));
  it("always returns a fixed-scale string, never a float", () => {
    expect(coerceMoney("1000").value).toBe("1000.00");
    expect(typeof coerceMoney("1000").value).toBe("string");
  });
});

describe("rates", () => {
  it("strips a percent sign", () => expect(coerceRate("5.5%").value).toBe("5.5000"));
  it("rescales a decimal-form column", () => expect(coerceRate("0.055", "decimal").value).toBe("5.5000"));
  it("leaves a percent-form column alone", () => expect(coerceRate("5.5", "percent").value).toBe("5.5000"));
  it("detects scale from the column median", () => {
    expect(detectRateScale(["0.055", "0.0625", "0.042"])).toBe("decimal");
    expect(detectRateScale(["5.5", "6.25", "4.2"])).toBe("percent");
  });
});

describe("state, zip, int, text", () => {
  it("maps names and shorthand", () => {
    expect(coerceState("California").value).toBe("CA");
    expect(coerceState("Calif.").value).toBe("CA");
    expect(coerceState("ca").value).toBe("CA");
  });
  it("fails on nonsense", () => expect(coerceState("Atlantis").ok).toBe(false));
  it("restores ZIP leading zeros", () => expect(coerceZip("1234").value).toBe("01234"));
  it("splits ZIP+4", () => expect(coerceZip("123456789").value).toBe("12345-6789"));
  it("parses ints with separators", () => expect(coerceInt("1,234").value).toBe(1234));
  it("normalizes text", () => expect(coerceText("  José   Ruiz ").value).toBe("José Ruiz"));
  it("parses epoch timestamps", () => expect(coerceTimestamp("1712000000").value).toMatch(/^2024-/));
  it("maps payment status synonyms", () => {
    expect(coercePaymentStatus("Paid Off").value).toBe("PAID_OFF");
    expect(coercePaymentStatus("30 days late").value).toBe("UNKNOWN");
  });
});
