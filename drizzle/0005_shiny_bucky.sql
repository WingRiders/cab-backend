CREATE TABLE IF NOT EXISTS "transaction_output" (
	"utxo_id" varchar PRIMARY KEY NOT NULL,
	"ogmios_utxo" jsonb NOT NULL,
	"slot" integer NOT NULL,
	"spend_slot" integer,
	"address" varchar NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_idx" ON "transaction_output" ("address");
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "transaction_output" ADD CONSTRAINT "transaction_output_slot_block_slot_fk" FOREIGN KEY ("slot") REFERENCES "block"("slot") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "transaction_output" ADD CONSTRAINT "transaction_output_spend_slot_block_slot_fk" FOREIGN KEY ("spend_slot") REFERENCES "block"("slot") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
