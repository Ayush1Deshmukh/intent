export type CoercionResult<T> = {
  ok: boolean;
  value: T | null;
  coercion: string;      // e.g. "date.dmy", "money.accounting" — "" when untouched
  error?: string;
};
export const untouched = <T,>(value: T | null): CoercionResult<T> => ({ ok: true, value, coercion: "" });
export const failed = <T,>(error: string): CoercionResult<T> => ({ ok: false, value: null, coercion: "", error });
