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
