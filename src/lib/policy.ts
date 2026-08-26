export type Role = "DATA_OPERATOR" | "REVIEWER" | "DATA_CONSUMER";

export const ROLE_LABEL: Record<Role, string> = {
  DATA_OPERATOR: "Data Operator",
  REVIEWER: "Reviewer",
  DATA_CONSUMER: "Data Consumer",
};

export const ROLE_BLURB: Record<Role, string> = {
  DATA_OPERATOR: "Uploads tapes, confirms the column mapping, triages exceptions and accepts proposals. Every acceptance becomes a pending change — it never edits a loan directly.",
  REVIEWER: "Sees only pending changes, as before-and-after diffs. Approves or rejects with a reason, then signs off the tape and issues the attestation.",
  DATA_CONSUMER: "Read-only. Verified records, full lineage, the audit chain and the integrity check. No write endpoint exists for this role.",
};

export type Action =
  | "tape:upload" | "tape:map" | "tape:attest" | "tape:read"
  | "proposal:request" | "proposal:accept" | "proposal:approve" | "exception:waive"
  | "rule:draft" | "rule:approve"
  | "audit:read" | "verify:run" | "export:generate" | "verified:read";

/**
 * One table, one check. Every route handler's first line is requireRole().
 * Note what the Data Consumer does NOT have: there is no write action listed for
 * it anywhere, so a read-only role is enforced by absence, not by a hidden button.
 */
export const POLICY: Record<Action, Role[]> = {
  "tape:upload":       ["DATA_OPERATOR"],
  "tape:map":          ["DATA_OPERATOR"],
  "tape:attest":       ["REVIEWER"],
  "tape:read":         ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"],
  "proposal:request":  ["DATA_OPERATOR"],
  "proposal:accept":   ["DATA_OPERATOR"],
  "proposal:approve":  ["REVIEWER"],
  "exception:waive":   ["DATA_OPERATOR", "REVIEWER"],
  "rule:draft":        ["DATA_OPERATOR", "REVIEWER"],
  "rule:approve":      ["REVIEWER"],
  "audit:read":        ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"],
  "verify:run":        ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"],
  "export:generate":   ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"],
  "verified:read":     ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"],
};

export const can = (role: Role, action: Action) => POLICY[action].includes(role);
export const ALL_ACTIONS = Object.keys(POLICY) as Action[];
export const ALL_ROLES: Role[] = ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"];
