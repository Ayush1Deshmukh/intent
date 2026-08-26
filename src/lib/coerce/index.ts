import { CANONICAL_FIELDS, CanonicalField, FIELD_META } from "@/lib/schema/fields";
import { coerceDate, detectDateFormat, DateFormat } from "./date";
import { coerceMoney } from "./money";
import { coerceRate, detectRateScale, RateScale } from "./rate";
import { coerceState } from "./state";
import {
  coerceInt, coerceText, coerceTimestamp, coerceZip,
  coerceDocStatus, coerceLoanType, coercePaymentStatus,
} from "./misc";

export * from "./date";
export * from "./money";
export * from "./rate";
export * from "./state";
export * from "./misc";
export * from "./types";

/** Column-level decisions, made once over the whole file and reused per row. */
export type ColumnHints = Partial<Record<CanonicalField, { dateFormat?: DateFormat; rateScale?: RateScale }>>;

export type NormalizedRow = {
  values: Partial<Record<CanonicalField, string | number | null>>;
  transformations: { field: string; before: string; after: string; coercion: string }[];
  /** field -> why it could not be coerced. Drives the FMT-* rules. */
  errors: Partial<Record<CanonicalField, string>>;
  /** raw value per canonical field, kept so lineage and the AI see what arrived */
  rawByField: Partial<Record<CanonicalField, string>>;
};

export function detectColumnHints(
  rows: Record<string, string>[],
  mapping: Map<string, CanonicalField>,
): ColumnHints {
  const hints: ColumnHints = {};
  const byField = new Map<CanonicalField, string[]>();
  for (const [header, field] of mapping) {
    const vals = rows.map((r) => r[header]).filter((v) => v != null && String(v).trim() !== "");
    byField.set(field, vals as string[]);
  }
  for (const [field, vals] of byField) {
    const kind = FIELD_META[field].kind;
    if (kind === "date") hints[field] = { dateFormat: detectDateFormat(vals) };
    if (kind === "rate") hints[field] = { rateScale: detectRateScale(vals) };
  }
  return hints;
}

export function normalizeRow(
  raw: Record<string, string>,
  mapping: Map<string, CanonicalField>,
  hints: ColumnHints = {},
): NormalizedRow {
  const out: NormalizedRow = { values: {}, transformations: [], errors: {}, rawByField: {} };

  for (const [header, field] of mapping) {
    const before = raw[header];
    if (before === undefined) continue;
    out.rawByField[field] = before;

    const meta = FIELD_META[field];
    let res;
    switch (meta.kind) {
      case "date":      res = coerceDate(before, hints[field]?.dateFormat ?? "unknown"); break;
      case "money":     res = coerceMoney(before, meta.scale ?? 2); break;
      case "rate":      res = coerceRate(before, hints[field]?.rateScale ?? "unknown", meta.scale ?? 4); break;
      case "state":     res = coerceState(before); break;
      case "zip":       res = coerceZip(before); break;
      case "int":       res = coerceInt(before); break;
      case "timestamp": res = coerceTimestamp(before); break;
      case "enum":
        res = field === "paymentStatus" ? coercePaymentStatus(before)
            : field === "loanType"      ? coerceLoanType(before)
            :                             coerceDocStatus(before);
        break;
      default:          res = coerceText(before);
    }

    if (!res.ok) {
      out.errors[field] = res.error ?? "could not be interpreted";
      out.values[field] = null;
      continue;
    }
    out.values[field] = res.value as string | number | null;
    if (res.coercion) {
      out.transformations.push({
        field,
        before: String(before),
        after: res.value === null ? "" : String(res.value),
        coercion: res.coercion,
      });
    }
  }

  for (const f of CANONICAL_FIELDS) if (!(f in out.values)) out.values[f] = null;
  return out;
}
