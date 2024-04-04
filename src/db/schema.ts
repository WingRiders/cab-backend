import {customType, integer, pgTable} from 'drizzle-orm/pg-core'

const bytea = customType<{data: Buffer}>({
	dataType: () => 'bytea',
})

export const blocks = pgTable('block', {
	slot: integer('slot').primaryKey(),
	hash: bytea('hash').notNull(),
})

export type NewBlock = typeof blocks.$inferInsert

export const transactions = pgTable('transaction', {
	txHash: bytea('tx_hash').primaryKey(),
	slot: integer('slot')
		.notNull()
		.references(() => blocks.slot, {onDelete: 'cascade'}),
})

export type NewTx = typeof transactions.$inferInsert

// Manually add to migration indexes for payment credential and staking credential
// on substr of address, Drizzle doesn't support defining this in schema yet
//
// CREATE INDEX payment_credential_idx ON address (substr(address, 2, 28));
// CREATE INDEX staking_credential_idx ON address (substr(address, 30, 28));
//
// note: substr indexes from 1, 1st byte - address type, 2-29 - payment cred, 30-58 - staking cred
export const addresses = pgTable('address', {
	address: bytea('address').primaryKey(),
	firstSlot: integer('slot')
		.notNull()
		.references(() => blocks.slot, {onDelete: 'cascade'}),
})

export type NewAddress = typeof addresses.$inferInsert
