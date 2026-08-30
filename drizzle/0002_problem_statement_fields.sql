ALTER TABLE "loan_records" ADD COLUMN "loan_purpose" text;--> statement-breakpoint
ALTER TABLE "loan_records" ADD COLUMN "last_payment_date" date;--> statement-breakpoint
ALTER TABLE "loan_records" ADD COLUMN "credit_grade" text;--> statement-breakpoint
ALTER TABLE "loan_records" ADD COLUMN "employment_length" text;--> statement-breakpoint
ALTER TABLE "loan_records" ADD COLUMN "income_band" text;--> statement-breakpoint
ALTER TABLE "loan_records" ADD COLUMN "servicer_name" text;--> statement-breakpoint
ALTER TABLE "loan_records" ADD COLUMN "source_system" text;