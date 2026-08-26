import { CoercionResult, failed } from "./types";

/** Excel eats leading zeros on ZIPs. Put them back — and record that we did. */
export function coerceZip(raw: string): CoercionResult<string> {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null, coercion: "" };
  const digits = s.replace(/[^0-9-]/g, "");
  if (/^\d{5}$/.test(digits)) return { ok: true, value: digits, coercion: digits === s ? "" : "zip.clean" };
  if (/^\d{5}-\d{4}$/.test(digits)) return { ok: true, value: digits, coercion: digits === s ? "" : "zip.clean" };
  if (/^\d{9}$/.test(digits)) return { ok: true, value: `${digits.slice(0,5)}-${digits.slice(5)}`, coercion: "zip.split" };
  if (/^\d{3,4}$/.test(digits)) return { ok: true, value: digits.padStart(5, "0"), coercion: "zip.pad" };
  return failed(`malformed ZIP "${raw}"`);
}

export function coerceInt(raw: string): CoercionResult<number> {
  const s = (raw ?? "").trim();
  if (!s || /^(n\/?a|null|none|-)$/i.test(s)) return { ok: true, value: null, coercion: "" };
  const cleaned = s.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.0+)?$/.test(cleaned)) return failed(`not an integer: "${raw}"`);
  const n = Math.trunc(Number(cleaned));
  return { ok: true, value: n, coercion: String(n) === s ? "" : "int.normalize" };
}

export function coerceText(raw: string): CoercionResult<string> {
  const s = (raw ?? "")
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { ok: true, value: null, coercion: "" };
  return { ok: true, value: s, coercion: s === raw ? "" : "text.normalize" };
}

export function coerceTimestamp(raw: string): CoercionResult<string> {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null, coercion: "" };
  if (/^\d{10}$/.test(s)) return { ok: true, value: new Date(+s * 1000).toISOString(), coercion: "ts.epoch_s" };
  if (/^\d{13}$/.test(s)) return { ok: true, value: new Date(+s).toISOString(), coercion: "ts.epoch_ms" };
  const d = new Date(s.includes("T") || s.includes(":") ? s : s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return failed(`unrecognised timestamp "${raw}"`);
  return { ok: true, value: d.toISOString(), coercion: "ts.parse" };
}

const PAY_STATUS: Record<string, string> = {
  current:"CURRENT", c:"CURRENT", performing:"CURRENT", ok:"CURRENT", "0":"CURRENT",
  delinquent:"DELINQUENT", late:"DELINQUENT", dlq:"DELINQUENT", past_due:"DELINQUENT", "past due":"DELINQUENT",
  default:"DEFAULT", defaulted:"DEFAULT", charged_off:"DEFAULT", "charge off":"DEFAULT", npl:"DEFAULT",
  paid:"PAID_OFF", paid_off:"PAID_OFF", "paid off":"PAID_OFF", closed:"PAID_OFF", payoff:"PAID_OFF", prepaid:"PAID_OFF",
  foreclosure:"FORECLOSURE", fcl:"FORECLOSURE", "in foreclosure":"FORECLOSURE", reo:"FORECLOSURE",
};
const LOAN_TYPE: Record<string, string> = {
  fixed:"FIXED", frm:"FIXED", "fixed rate":"FIXED", "fixed-rate":"FIXED",
  arm:"ARM", adjustable:"ARM", "adjustable rate":"ARM", variable:"ARM", floating:"ARM",
  heloc:"HELOC", "home equity":"HELOC", heil:"HELOC",
  auto:"AUTO", vehicle:"AUTO", car:"AUTO",
  personal:"PERSONAL", unsecured:"PERSONAL", consumer:"PERSONAL",
};
const DOC_STATUS: Record<string, string> = {
  complete:"COMPLETE", full:"COMPLETE", received:"COMPLETE", y:"COMPLETE", yes:"COMPLETE", available:"COMPLETE",
  partial:"PARTIAL", incomplete:"PARTIAL", pending:"PARTIAL",
  missing:"MISSING", none:"MISSING", n:"MISSING", no:"MISSING", "not available":"MISSING", unavailable:"MISSING",
};

function mapEnum(raw: string, table: Record<string, string>, name: string, fallback: string): CoercionResult<string> {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null, coercion: "" };
  const key = s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const hit = table[key] ?? table[key.replace(/ /g, "_")];
  if (hit) return { ok: true, value: hit, coercion: hit === s ? "" : `enum.${name}` };
  return { ok: true, value: fallback, coercion: `enum.${name}_unknown` };
}

export const coercePaymentStatus = (raw: string) => mapEnum(raw, PAY_STATUS, "payment_status", "UNKNOWN");
export const coerceLoanType      = (raw: string) => mapEnum(raw, LOAN_TYPE, "loan_type", "OTHER");
export const coerceDocStatus     = (raw: string) => mapEnum(raw, DOC_STATUS, "document_status", "UNKNOWN");
