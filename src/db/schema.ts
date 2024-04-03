import {integer, pgTable, varchar} from 'drizzle-orm/pg-core'

export const blocks = pgTable('blocks', {
	slot: integer('slot').primaryKey(),
	hash: varchar('hash', {length: 64}).notNull(),
})

export type NewBlock = typeof blocks.$inferInsert
