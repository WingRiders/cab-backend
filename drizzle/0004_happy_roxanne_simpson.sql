ALTER TABLE "address" DROP CONSTRAINT "address_first_slot_block_slot_fk";
--> statement-breakpoint
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_slot_block_slot_fk";
--> statement-breakpoint

-- This migration adds a new column to the block table, so we delete all data
-- to force a full re-sync.
DELETE FROM "block";
DELETE FROM "address";
DELETE FROM "transaction";

ALTER TABLE "block" ADD COLUMN "height" integer NOT NULL;