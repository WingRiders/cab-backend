ALTER TABLE "transaction_output" ADD COLUMN "payment_credential" "bytea" NOT NULL DEFAULT 'not-set';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "txo_payment_credential_idx" ON "transaction_output" ("payment_credential");

ALTER TABLE "transaction_output" ALTER COLUMN "payment_credential" DROP DEFAULT;