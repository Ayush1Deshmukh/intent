/**
 * Verified Tape — database schema.
 *
 * Three data zones, deliberately separated so provenance is never destroyed:
 *   ZONE 1  RAW QUARANTINE   sourceFiles + rawRecords   verbatim strings, never mutated
 *   ZONE 2  ACTIVE WORKING   loanRecords                normalized, corrected under maker-checker
 *   ZONE 3  VERIFIED LEDGER  verifiedRecords            sealed artifact + hash, append-only
 *
 * Money and rates are `numeric` and come back from pg as exact decimal STRINGS.
 * That is deliberate: floats would silently break record hashes.
 */
import {
  pgTable, pgEnum, text, integer, timestamp, date, numeric, boolean,
  jsonb, doublePrecision, uniqueIndex, index, char,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createId } from "@/lib/id";

export const roleEnum       = pgEnum("role", ["DATA_OPERATOR", "REVIEWER", "DATA_CONSUMER"]);
export const tapeStatusEnum = pgEnum("tape_status", ["UPLOADED","MAPPING","NORMALIZED","VALIDATED","IN_REVIEW","VERIFIED","REJECTED"]);
export const sourceKindEnum = pgEnum("source_kind", ["LOAN_TAPE","SERVICER_UPDATE","DOCUMENT_MANIFEST"]);
export const severityEnum   = pgEnum("severity", ["BLOCKER","CRITICAL","WARNING","INFO"]);
export const excStatusEnum  = pgEnum("exc_status", ["OPEN","PENDING_APPROVAL","RESOLVED","WAIVED","REJECTED"]);
export const propSourceEnum = pgEnum("prop_source", ["AI","RULE","HUMAN"]);
export const propStatusEnum = pgEnum("prop_status", ["DRAFT","ACCEPTED_BY_OPERATOR","APPROVED","REJECTED"]);
export const mapMethodEnum  = pgEnum("map_method", ["EXACT","ALIAS","FUZZY","AI","MANUAL"]);
export const recStatusEnum  = pgEnum("rec_status", ["PENDING","EXCEPTION","VERIFIED","REJECTED"]);

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(createId),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tapes = pgTable("tapes", {
  id: text("id").primaryKey().$defaultFn(createId),
  name: text("name").notNull(),
  status: tapeStatusEnum("status").notNull().default("UPLOADED"),
  rowCount: integer("row_count").notNull().default(0),
  uploadedById: text("uploaded_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byStatus: index("tapes_status_idx").on(t.status, t.createdAt) }));

/* ---------------------------------------------------------------- ZONE 1 */

export const sourceFiles = pgTable("source_files", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }),
  kind: sourceKindEnum("kind").notNull(),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  headers: jsonb("headers").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rawRecords = pgTable("raw_records", {
  id: text("id").primaryKey().$defaultFn(createId),
  sourceFileId: text("source_file_id").notNull().references(() => sourceFiles.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  original: jsonb("original").$type<Record<string, string>>().notNull(),
  rowHash: text("row_hash").notNull(),
  parseError: text("parse_error"),
}, (t) => ({ uq: uniqueIndex("raw_file_row_uq").on(t.sourceFileId, t.rowNumber) }));

/* ---------------------------------------------------------------- ZONE 2 */

export const loanRecords = pgTable("loan_records", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }),
  rawRecordId: text("raw_record_id").notNull().references(() => rawRecords.id, { onDelete: "cascade" }).unique(),

  loanId: text("loan_id"),
  borrowerId: text("borrower_id"),
  loanType: text("loan_type"),
  loanPurpose: text("loan_purpose"),
  originationDate: date("origination_date"),
  maturityDate: date("maturity_date"),
  originalPrincipal: numeric("original_principal", { precision: 18, scale: 2 }),
  currentBalance: numeric("current_balance", { precision: 18, scale: 2 }),
  interestRate: numeric("interest_rate", { precision: 9, scale: 4 }),
  termMonths: integer("term_months"),
  paymentAmount: numeric("payment_amount", { precision: 18, scale: 2 }),
  paymentStatus: text("payment_status"),
  daysPastDue: integer("days_past_due"),
  lastPaymentDate: date("last_payment_date"),
  borrowerState: char("borrower_state", { length: 2 }),
  borrowerZip: text("borrower_zip"),
  creditScore: integer("credit_score"),
  creditGrade: text("credit_grade"),
  employmentLength: text("employment_length"),
  incomeBand: text("income_band"),
  appraisedValue: numeric("appraised_value", { precision: 18, scale: 2 }),
  servicerId: text("servicer_id"),
  servicerName: text("servicer_name"),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
  documentStatus: text("document_status"),
  sourceSystem: text("source_system"),

  verificationStatus: recStatusEnum("verification_status").notNull().default("PENDING"),
  version: integer("version").notNull().default(1),
  recordHash: text("record_hash").notNull(),
}, (t) => ({
  byLoan: index("loan_tape_loanid_idx").on(t.tapeId, t.loanId),
  byStatus: index("loan_tape_status_idx").on(t.tapeId, t.verificationStatus),
}));

export const transformations = pgTable("transformations", {
  id: text("id").primaryKey().$defaultFn(createId),
  recordId: text("record_id").notNull().references(() => loanRecords.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  before: text("before"),
  after: text("after"),
  coercion: text("coercion").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byRec: index("transform_rec_idx").on(t.recordId, t.field) }));

export const fieldMappings = pgTable("field_mappings", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }),
  sourceKind: sourceKindEnum("source_kind").notNull().default("LOAN_TAPE"),
  sourceHeader: text("source_header").notNull(),
  canonicalField: text("canonical_field"),
  method: mapMethodEnum("method").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  detectedFormat: text("detected_format"),
  samples: jsonb("samples").$type<string[]>().notNull(),
  rationale: text("rationale"),
  confirmedById: text("confirmed_by_id"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (t) => ({ uq: uniqueIndex("mapping_uq").on(t.tapeId, t.sourceKind, t.sourceHeader) }));

export const rules = pgTable("rules", {
  id: text("id").primaryKey().$defaultFn(createId),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  severity: severityEnum("severity").notNull(),
  scope: text("scope").notNull().default("record"),
  field: text("field"),
  expected: text("expected").notNull().default(""),
  expression: jsonb("expression").notNull(),
  dependsOn: jsonb("depends_on").$type<string[]>(),
  repairHint: text("repair_hint"),
  version: integer("version").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  createdById: text("created_by_id"),
  approvedById: text("approved_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exceptions = pgTable("exceptions", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }),
  recordId: text("record_id").references(() => loanRecords.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull().references(() => rules.id),
  field: text("field"),
  observed: text("observed"),
  expected: text("expected"),
  detail: jsonb("detail"),
  severity: severityEnum("severity").notNull(),
  status: excStatusEnum("status").notNull().default("OPEN"),
  clusterKey: text("cluster_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  bySev: index("exc_tape_sev_idx").on(t.tapeId, t.severity, t.status),
  byRule: index("exc_tape_rule_idx").on(t.tapeId, t.ruleId),
}));

export const proposals = pgTable("proposals", {
  id: text("id").primaryKey().$defaultFn(createId),
  exceptionId: text("exception_id").notNull().references(() => exceptions.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  rationale: text("rationale").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  source: propSourceEnum("source").notNull(),
  model: text("model"),
  promptHash: text("prompt_hash"),
  promptText: text("prompt_text"),
  responseText: text("response_text"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  latencyMs: integer("latency_ms"),
  evidence: jsonb("evidence").$type<{ label: string; value: string }[]>(),
  status: propStatusEnum("status").notNull().default("DRAFT"),
  acceptedById: text("accepted_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const decisions = pgTable("decisions", {
  id: text("id").primaryKey().$defaultFn(createId),
  proposalId: text("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  actorRole: roleEnum("actor_role").notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey().$defaultFn(createId),
  seq: integer("seq").notNull().unique(),
  tapeId: text("tape_id"),
  actorId: text("actor_id"),
  actorRole: roleEnum("actor_role"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => ({ byTape: index("audit_tape_seq_idx").on(t.tapeId, t.seq) }));

/* ---------------------------------------------------------------- ZONE 3 */

export const verifiedRecords = pgTable("verified_records", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }),
  loanRecordId: text("loan_record_id").notNull().references(() => loanRecords.id, { onDelete: "cascade" }).unique(),
  loanId: text("loan_id").notNull(),
  payload: jsonb("payload").notNull(),
  lineage: jsonb("lineage").notNull(),
  recordHash: text("record_hash").notNull(),
  verifiedById: text("verified_by_id").notNull(),
  verifiedByEmail: text("verified_by_email").notNull(),
  eventSeq: integer("event_seq").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byLoan: index("verified_tape_loan_idx").on(t.tapeId, t.loanId) }));

export const attestations = pgTable("attestations", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }).unique(),
  merkleRoot: text("merkle_root").notNull(),
  leaves: jsonb("leaves").$type<{ loanRecordId: string; loanId: string; hash: string }[]>().notNull(),
  recordCount: integer("record_count").notNull(),
  signerId: text("signer_id").notNull(),
  signerEmail: text("signer_email").notNull(),
  lastEventSeq: integer("last_event_seq").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const servicerRefs = pgTable("servicer_refs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey().$defaultFn(createId),
  tapeId: text("tape_id").notNull().references(() => tapes.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  total: integer("total").notNull().default(0),
  done: integer("done").notNull().default(0),
  state: text("state").notNull().default("running"),
  message: text("message"),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** single-row table taken FOR UPDATE to serialize audit-chain appends */
export const chainLock = pgTable("chain_lock", {
  id: integer("id").primaryKey().default(1),
  note: text("note").notNull().default("audit chain append lock"),
});

export const aiCache = pgTable("ai_cache", {
  promptHash: text("prompt_hash").primaryKey(),
  job: text("job").notNull(),
  response: text("response").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotency = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* relations used by drizzle query api */
export const tapeRelations = relations(tapes, ({ many, one }) => ({
  files: many(sourceFiles), records: many(loanRecords), exceptions: many(exceptions),
  attestation: one(attestations, { fields: [tapes.id], references: [attestations.tapeId] }),
}));
export const loanRelations = relations(loanRecords, ({ one, many }) => ({
  tape: one(tapes, { fields: [loanRecords.tapeId], references: [tapes.id] }),
  raw: one(rawRecords, { fields: [loanRecords.rawRecordId], references: [rawRecords.id] }),
  transformations: many(transformations), exceptions: many(exceptions),
}));
export const excRelations = relations(exceptions, ({ one, many }) => ({
  rule: one(rules, { fields: [exceptions.ruleId], references: [rules.id] }),
  record: one(loanRecords, { fields: [exceptions.recordId], references: [loanRecords.id] }),
  proposals: many(proposals),
}));
export const propRelations = relations(proposals, ({ one, many }) => ({
  exception: one(exceptions, { fields: [proposals.exceptionId], references: [exceptions.id] }),
  decisions: many(decisions),
}));
