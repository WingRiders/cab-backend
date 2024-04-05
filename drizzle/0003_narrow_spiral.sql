ALTER TABLE "address" RENAME COLUMN "slot" TO "first_slot";--> statement-breakpoint
ALTER TABLE "address" DROP CONSTRAINT "address_slot_block_slot_fk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "first_slot_idx" ON "address" ("first_slot");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slot_idx" ON "transaction" ("slot");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "address" ADD CONSTRAINT "address_first_slot_block_slot_fk" FOREIGN KEY ("first_slot") REFERENCES "block"("slot") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
