import {relations} from 'drizzle-orm'
import {customType, index, integer, pgTable} from 'drizzle-orm/pg-core'
import {logger} from '../logger'

const bytea = customType<{data: Buffer}>({
  dataType: () => 'bytea',
  fromDriver(val) {
    if (Buffer.isBuffer(val)) return val
    // Drizzle-ORM returns bytea columns in joined tables as hex strings with \x prefix
    if (typeof val === 'string' && val.startsWith('\\x'))
      return Buffer.from(val.substring(2), 'hex')

    logger.error({val}, 'Unexpected value for bytea')
    throw new Error(`Unexpected value for bytea: ${val}`)
  },
})

export const blocks = pgTable('block', {
  slot: integer('slot').primaryKey(),
  hash: bytea('hash').notNull(),
  height: integer('height').notNull(),
})

export type NewBlock = typeof blocks.$inferInsert

export const transactions = pgTable(
  'transaction',
  {
    txHash: bytea('tx_hash').primaryKey(),
    slot: integer('slot').notNull(),
  },
  (table) => ({
    slotIdx: index('slot_idx').on(table.slot),
  }),
)

export const transactionsRelations = relations(transactions, ({one}) => ({
  block: one(blocks, {fields: [transactions.slot], references: [blocks.slot]}),
}))

export type NewTx = typeof transactions.$inferInsert

// Manually add to migration indexes for payment credential and staking credential
// on substr of address, Drizzle doesn't support defining this in schema yet
//
// CREATE INDEX payment_credential_idx ON address (substr(address, 2, 28));
// CREATE INDEX staking_credential_idx ON address (substr(address, 30, 28));
//
// note: substr indexes from 1, 1st byte - address type, 2-29 - payment cred, 30-58 - staking cred
export const addresses = pgTable(
  'address',
  {
    address: bytea('address').primaryKey(),
    firstSlot: integer('first_slot').notNull(),
  },
  (table) => ({
    firstSlotIdx: index('first_slot_idx').on(table.firstSlot),
  }),
)

export type NewAddress = typeof addresses.$inferInsert
