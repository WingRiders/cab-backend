ALTER TABLE "transaction_output" ADD COLUMN IF NOT EXISTS "tx_hash" "bytea" NOT NULL DEFAULT decode('00', 'hex');

ALTER TABLE "transaction_output" ALTER COLUMN "tx_hash" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "txo_tx_hash_idx" ON "transaction_output" ("tx_hash");
