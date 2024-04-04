CREATE TABLE IF NOT EXISTS "address" (
	"address" "bytea" PRIMARY KEY NOT NULL,
	"slot" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "address" ADD CONSTRAINT "address_slot_block_slot_fk" FOREIGN KEY ("slot") REFERENCES "block"("slot") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX payment_credential_idx ON address (substr(address, 2, 28));
CREATE INDEX staking_credential_idx ON address (substr(address, 30, 28));
