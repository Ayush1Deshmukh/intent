CREATE TYPE "public"."exc_status" AS ENUM('OPEN', 'PENDING_APPROVAL', 'RESOLVED', 'WAIVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."map_method" AS ENUM('EXACT', 'ALIAS', 'FUZZY', 'AI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."prop_source" AS ENUM('AI', 'RULE', 'HUMAN');--> statement-breakpoint
CREATE TYPE "public"."prop_status" AS ENUM('DRAFT', 'ACCEPTED_BY_OPERATOR', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."rec_status" AS ENUM('PENDING', 'EXCEPTION', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('DATA_OPERATOR', 'REVIEWER', 'DATA_CONSUMER');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('BLOCKER', 'CRITICAL', 'WARNING', 'INFO');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('LOAN_TAPE', 'SERVICER_UPDATE', 'DOCUMENT_MANIFEST');--> statement-breakpoint
CREATE TYPE "public"."tape_status" AS ENUM('UPLOADED', 'MAPPING', 'NORMALIZED', 'VALIDATED', 'IN_REVIEW', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "ai_cache" (
	"prompt_hash" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"response" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"merkle_root" text NOT NULL,
	"leaves" jsonb NOT NULL,
	"record_count" integer NOT NULL,
	"signer_id" text NOT NULL,
	"signer_email" text NOT NULL,
	"last_event_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attestations_tape_id_unique" UNIQUE("tape_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"tape_id" text,
	"actor_id" text,
	"actor_role" "role",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "chain_lock" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"note" text DEFAULT 'audit chain append lock' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" "role" NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"record_id" text,
	"rule_id" text NOT NULL,
	"field" text,
	"observed" text,
	"expected" text,
	"detail" jsonb,
	"severity" "severity" NOT NULL,
	"status" "exc_status" DEFAULT 'OPEN' NOT NULL,
	"cluster_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"source_kind" "source_kind" DEFAULT 'LOAN_TAPE' NOT NULL,
	"source_header" text NOT NULL,
	"canonical_field" text,
	"method" "map_method" NOT NULL,
	"confidence" double precision NOT NULL,
	"detected_format" text,
	"samples" jsonb NOT NULL,
	"rationale" text,
	"confirmed_by_id" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"kind" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"message" text,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"raw_record_id" text NOT NULL,
	"loan_id" text,
	"borrower_id" text,
	"loan_type" text,
	"origination_date" date,
	"maturity_date" date,
	"original_principal" numeric(18, 2),
	"current_balance" numeric(18, 2),
	"interest_rate" numeric(9, 4),
	"term_months" integer,
	"payment_amount" numeric(18, 2),
	"payment_status" text,
	"days_past_due" integer,
	"borrower_state" char(2),
	"borrower_zip" text,
	"credit_score" integer,
	"appraised_value" numeric(18, 2),
	"servicer_id" text,
	"last_updated_at" timestamp with time zone,
	"document_status" text,
	"verification_status" "rec_status" DEFAULT 'PENDING' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"record_hash" text NOT NULL,
	CONSTRAINT "loan_records_raw_record_id_unique" UNIQUE("raw_record_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"exception_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"rationale" text NOT NULL,
	"confidence" double precision NOT NULL,
	"source" "prop_source" NOT NULL,
	"model" text,
	"prompt_hash" text,
	"prompt_text" text,
	"response_text" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"evidence" jsonb,
	"status" "prop_status" DEFAULT 'DRAFT' NOT NULL,
	"accepted_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_records" (
	"id" text PRIMARY KEY NOT NULL,
	"source_file_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"original" jsonb NOT NULL,
	"row_hash" text NOT NULL,
	"parse_error" text
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"severity" "severity" NOT NULL,
	"scope" text DEFAULT 'record' NOT NULL,
	"field" text,
	"expected" text DEFAULT '' NOT NULL,
	"expression" jsonb NOT NULL,
	"repair_hint" text,
	"version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"approved_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "servicer_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"headers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tapes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "tape_status" DEFAULT 'UPLOADED' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformations" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"field" text NOT NULL,
	"before" text,
	"after" text,
	"coercion" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verified_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tape_id" text NOT NULL,
	"loan_record_id" text NOT NULL,
	"loan_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"lineage" jsonb NOT NULL,
	"record_hash" text NOT NULL,
	"verified_by_id" text NOT NULL,
	"verified_by_email" text NOT NULL,
	"event_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verified_records_loan_record_id_unique" UNIQUE("loan_record_id")
);
--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_record_id_loan_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."loan_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_records" ADD CONSTRAINT "loan_records_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_records" ADD CONSTRAINT "loan_records_raw_record_id_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."raw_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformations" ADD CONSTRAINT "transformations_record_id_loan_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."loan_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_records" ADD CONSTRAINT "verified_records_tape_id_tapes_id_fk" FOREIGN KEY ("tape_id") REFERENCES "public"."tapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_records" ADD CONSTRAINT "verified_records_loan_record_id_loan_records_id_fk" FOREIGN KEY ("loan_record_id") REFERENCES "public"."loan_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_tape_seq_idx" ON "audit_events" USING btree ("tape_id","seq");--> statement-breakpoint
CREATE INDEX "exc_tape_sev_idx" ON "exceptions" USING btree ("tape_id","severity","status");--> statement-breakpoint
CREATE INDEX "exc_tape_rule_idx" ON "exceptions" USING btree ("tape_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_uq" ON "field_mappings" USING btree ("tape_id","source_kind","source_header");--> statement-breakpoint
CREATE INDEX "loan_tape_loanid_idx" ON "loan_records" USING btree ("tape_id","loan_id");--> statement-breakpoint
CREATE INDEX "loan_tape_status_idx" ON "loan_records" USING btree ("tape_id","verification_status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_file_row_uq" ON "raw_records" USING btree ("source_file_id","row_number");--> statement-breakpoint
CREATE INDEX "tapes_status_idx" ON "tapes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "transform_rec_idx" ON "transformations" USING btree ("record_id","field");--> statement-breakpoint
CREATE INDEX "verified_tape_loan_idx" ON "verified_records" USING btree ("tape_id","loan_id");