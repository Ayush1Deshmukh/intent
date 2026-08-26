import { CoercionResult, failed } from "./types";

/**
 * Currency. Handles symbols, thousands separators, accounting negatives and the
 * European decimal comma. Returns a fixed-scale STRING — never a float.
 */
export function coerceMoney(raw: string, scale = 2): CoercionResult<string> {
  let s = (raw ?? "").normalize("NFC").replace(/ /g, " ").trim();
  if (!s || /^(n\/?a|null|none|-|--)$/i.test(s)) return { ok: true, value: null, coercion: "" };

  let coercion = "";
  let negative = false;

  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); coercion = "money.accounting"; }
  const hadSymbol = /[$€£¥₹]/.test(s);
  s = s.replace(/[$€£¥₹]/g, "").replace(/\s/g, "").trim();
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot && /,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");           // 1.234,56 -> 1234.56
    coercion = coercion || "money.eu";
  } else {
    if (/,/.test(s)) coercion = coercion || "money.separators";
    s = s.replace(/,/g, "");
  }
  if (!coercion && hadSymbol) coercion = "money.symbol";

  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return failed(`not a number: "${raw}"`);
  const n = Number(s);
  if (!Number.isFinite(n)) return failed(`not a number: "${raw}"`);

  const value = (negative ? -n : n).toFixed(scale);
  return { ok: true, value, coercion: coercion || (raw.trim() === value ? "" : "money.normalize") };
}
