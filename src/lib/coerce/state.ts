import { CoercionResult, failed } from "./types";

export const US_STATES: Record<string, string> = {
  AL:"alabama",AK:"alaska",AZ:"arizona",AR:"arkansas",CA:"california",CO:"colorado",CT:"connecticut",
  DE:"delaware",DC:"district of columbia",FL:"florida",GA:"georgia",HI:"hawaii",ID:"idaho",IL:"illinois",
  IN:"indiana",IA:"iowa",KS:"kansas",KY:"kentucky",LA:"louisiana",ME:"maine",MD:"maryland",
  MA:"massachusetts",MI:"michigan",MN:"minnesota",MS:"mississippi",MO:"missouri",MT:"montana",
  NE:"nebraska",NV:"nevada",NH:"new hampshire",NJ:"new jersey",NM:"new mexico",NY:"new york",
  NC:"north carolina",ND:"north dakota",OH:"ohio",OK:"oklahoma",OR:"oregon",PA:"pennsylvania",
  RI:"rhode island",SC:"south carolina",SD:"south dakota",TN:"tennessee",TX:"texas",UT:"utah",
  VT:"vermont",VA:"virginia",WA:"washington",WV:"west virginia",WI:"wisconsin",WY:"wyoming",PR:"puerto rico",
};

const NAME_TO_CODE = new Map(Object.entries(US_STATES).map(([code, name]) => [name, code]));

/** common abbreviations that are not the USPS code */
const SHORTHAND: Record<string, string> = {
  calif: "CA", cal: "CA", fla: "FL", mass: "MA", penn: "PA", penna: "PA", conn: "CT",
  tenn: "TN", wash: "WA", ariz: "AZ", colo: "CO", minn: "MN", wisc: "WI", mich: "MI",
  ill: "IL", ind: "IN", kans: "KS", nebr: "NE", okla: "OK", oreg: "OR", tex: "TX",
};

export function coerceState(raw: string): CoercionResult<string> {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null, coercion: "" };

  const upper = s.toUpperCase().replace(/\./g, "").trim();
  if (upper.length === 2 && US_STATES[upper]) {
    return { ok: true, value: upper, coercion: upper === s ? "" : "state.normalize" };
  }

  const lower = s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const byName = NAME_TO_CODE.get(lower);
  if (byName) return { ok: true, value: byName, coercion: "state.name" };

  const short = SHORTHAND[lower];
  if (short) return { ok: true, value: short, coercion: "state.fuzzy" };

  // prefix match: "calif", "californ"
  for (const [name, code] of NAME_TO_CODE) {
    if (name.startsWith(lower) && lower.length >= 4) {
      return { ok: true, value: code, coercion: "state.fuzzy" };
    }
  }
  return failed(`unrecognised state "${raw}"`);
}
