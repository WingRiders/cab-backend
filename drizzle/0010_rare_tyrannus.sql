ALTER TABLE "transaction" ADD COLUMN "tx_index" integer NOT NULL DEFAULT -1;

ALTER TABLE "transaction" ALTER COLUMN "tx_index" DROP DEFAULT;
