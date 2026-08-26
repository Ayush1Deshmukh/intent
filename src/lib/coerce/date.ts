import { CoercionResult, failed } from "./types";

export type DateFormat = "iso" | "mdy" | "dmy" | "compact" | "long" | "excel" | "mixed" | "unknown";

const MONTHS: Record<string, number> = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
  january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
};

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Excel serial: day 1 is 1900-01-01, with the famous 1900 leap-year bug -> epoch 1899-12-30 */
export function excelSerialToIso(n: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse one date cell. `hint` is the format the whole column resolved to, so a
 * column is parsed consistently instead of cell-by-cell guessing.
 */
export function coerceDate(raw: string, hint: DateFormat = "unknown"): CoercionResult<string> {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null, coercion: "" };

  // ISO first — unambiguous
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return isRealDate(y, mo, d)
      ? { ok: true, value: iso(y, mo, d), coercion: "date.iso" }
      : failed(`impossible date "${s}"`);
  }

  // Excel serial
  if (/^\d{5}$/.test(s)) {
    const n = +s;
    if (n >= 20000 && n <= 60000) return { ok: true, value: excelSerialToIso(n), coercion: "date.excel" };
  }

  // YYYYMMDD
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return isRealDate(y, mo, d)
      ? { ok: true, value: iso(y, mo, d), coercion: "date.compact" }
      : failed(`impossible date "${s}"`);
  }

  // Mon D, YYYY  /  D Mon YYYY
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const [mo, d, y] = [MONTHS[m[1].toLowerCase()], +m[2], +m[3]];
    return isRealDate(y, mo, d)
      ? { ok: true, value: iso(y, mo, d), coercion: "date.long" }
      : failed(`impossible date "${s}"`);
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const [d, mo, y] = [+m[1], MONTHS[m[2].toLowerCase()], +m[3]];
    return isRealDate(y, mo, d)
      ? { ok: true, value: iso(y, mo, d), coercion: "date.long" }
      : failed(`impossible date "${s}"`);
  }

  // slash / dash separated, two orderings
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (m[3].length === 2) y += y < 50 ? 2000 : 1900;

    const order: DateFormat = hint === "dmy" || hint === "mdy" ? hint : a > 12 ? "dmy" : "mdy";
    const [mo, d] = order === "dmy" ? [b, a] : [a, b];

    if (isRealDate(y, mo, d)) return { ok: true, value: iso(y, mo, d), coercion: `date.${order}` };

    // the requested ordering is impossible — try the other one before failing,
    // but report it, because a silently flipped date is worse than an exception
    const [mo2, d2] = order === "dmy" ? [a, b] : [b, a];
    if (isRealDate(y, mo2, d2)) {
      return failed(`ambiguous date "${s}": invalid as ${order.toUpperCase()}, valid only as the other ordering`);
    }
    return failed(`impossible date "${s}"`);
  }

  // month-year only, e.g. "04-2025"
  m = s.match(/^(\d{1,2})[/\-.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    return failed(`incomplete date "${s}": month and year only, no day`);
  }

  return failed(`unrecognised date format "${s}"`);
}

/**
 * Column-level format detection.
 * The rule, decided once and written down: if ANY value has a first component
 * above 12, the whole column is DD/MM. If some rows are only valid as DD/MM and
 * others only as MM/DD, the column is MIXED — which is a finding, not a guess.
 */
export function detectDateFormat(values: string[]): DateFormat {
  let slash = 0, dmyOnly = 0, mdyOnly = 0, isoN = 0, excel = 0, longN = 0;
  for (const raw of values) {
    const s = (raw ?? "").trim();
    if (!s) continue;
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { isoN++; continue; }
    if (/^\d{5}$/.test(s) && +s >= 20000 && +s <= 60000) { excel++; continue; }
    if (/[A-Za-z]{3}/.test(s)) { longN++; continue; }
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
    if (!m) continue;
    slash++;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmyOnly++;
    else if (b > 12 && a <= 12) mdyOnly++;
  }
  if (slash === 0) {
    if (isoN) return "iso";
    if (excel) return "excel";
    if (longN) return "long";
    return "unknown";
  }
  if (dmyOnly > 0 && mdyOnly > 0) return "mixed";
  if (dmyOnly > 0) return "dmy";
  return "mdy";
}
