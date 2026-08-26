/**
 * canonicalJson — the hashing contract.
 *
 * Every byte that goes into a hash passes through here, so the rules are strict
 * and deliberately hand-written rather than delegated to JSON.stringify (whose
 * number formatting is exactly the drift we are defending against).
 *
 *   1. object keys sorted lexicographically, recursively
 *   2. numbers are never emitted as JS numbers — decimals arrive as strings at
 *      their declared scale (money 2, rate 4), integers as plain digits
 *   3. dates emit as YYYY-MM-DD (UTC, date only); timestamps as ISO-8601 Z
 *   4. null is emitted EXPLICITLY, never dropped: a missing field and a null
 *      field must hash differently
 *   5. strings are NFC-normalized and trimmed
 *   6. no whitespace anywhere in the output
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function esc(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";

  if (typeof value === "string") return esc(value.normalize("NFC").trim());
  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalJson: refusing to hash a non-finite number (${value})`);
    }
    // Number#toString is the spec's shortest round-trip representation, so it is
    // deterministic across engines. That is enough for event payloads, which carry
    // things like a model confidence of 0.95.
    //
    // It is NOT enough for money: 1000 and 1000.00 are the same JS number but must
    // hash identically and must never drift. So business values never reach here as
    // numbers at all — businessFields() puts every decimal through fixed(), which
    // produces a fixed-scale string. That is the invariant, and hash.test.ts holds it.
    return String(value);
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => esc(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
  }

  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

/** format a pg numeric string (or null) at a fixed scale, for hashing */
export function fixed(value: string | number | null | undefined, scale: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(scale);
}

/** YYYY-MM-DD from a Date, an ISO string, or a pg date string */
export function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
