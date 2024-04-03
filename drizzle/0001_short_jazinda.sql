CREATE TABLE IF NOT EXISTS "transaction" (
	"tx_hash" "bytea" PRIMARY KEY NOT NULL,
	"slot" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_slot_block_slot_fk" FOREIGN KEY ("slot") REFERENCES "block"("slot") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
