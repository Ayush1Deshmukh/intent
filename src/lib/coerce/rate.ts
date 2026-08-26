import { CoercionResult, failed } from "./types";

export type RateScale = "percent" | "decimal" | "unknown";

/**
 * Interest rates arrive as "5.5%", "5.5" and "0.055" — often in the same file.
 * A single cell holding 0.055 is unknowable; a COLUMN of them is obvious, so the
 * scale decision is made once for the column and passed in here.
 */
export function detectRateScale(values: string[]): RateScale {
  const nums: number[] = [];
  let anyPercentSign = false;
  for (const raw of values) {
    const s = (raw ?? "").trim();
    if (!s) continue;
    if (s.includes("%")) { anyPercentSign = true; continue; }
    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n)) nums.push(Math.abs(n));
  }
  if (nums.length === 0) return anyPercentSign ? "percent" : "unknown";
  nums.sort((a, b) => a - b);
  const median = nums[Math.floor(nums.length / 2)];
  return median < 0.5 ? "decimal" : "percent";
}

export function coerceRate(raw: string, columnScale: RateScale = "unknown", scale = 4): CoercionResult<string> {
  const s = (raw ?? "").trim();
  if (!s || /^(n\/?a|null|none|-)$/i.test(s)) return { ok: true, value: null, coercion: "" };

  if (s.includes("%")) {
    const n = Number(s.replace(/[%,\s]/g, ""));
    if (!Number.isFinite(n)) return failed(`not a rate: "${raw}"`);
    return { ok: true, value: n.toFixed(scale), coercion: "rate.percent" };
  }

  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return failed(`not a rate: "${raw}"`);

  if (columnScale === "decimal") {
    return { ok: true, value: (n * 100).toFixed(scale), coercion: "rate.decimal_scaled" };
  }
  return { ok: true, value: n.toFixed(scale), coercion: n.toFixed(scale) === s ? "" : "rate.asis" };
}
