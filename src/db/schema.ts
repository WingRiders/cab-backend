import {relations} from 'drizzle-orm'
import {customType, index, integer, jsonb, pgTable, varchar} from 'drizzle-orm/pg-core'
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
    txIndex: integer('tx_index').notNull(), // index of the transaction in the block
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

export const transactionOutputs = pgTable(
  'transaction_output',
  {
    utxoId: varchar('utxo_id').primaryKey(),
    txHash: bytea('tx_hash').notNull(),
    ogmiosUtxo: jsonb('ogmios_utxo').notNull(),
    slot: integer('slot').notNull(),
    spendSlot: integer('spend_slot'),
    address: varchar('address').notNull(),
    paymentCredential: bytea('payment_credential').notNull(),
  },
  (table) => ({
    txHashIdx: index('txo_tx_hash_idx').on(table.txHash),
    addressIdx: index('address_idx').on(table.address),
    slotIdx: index('transaction_output_slot_idx').on(table.slot),
    spendSlotIdx: index('spend_slot_idx').on(table.spendSlot),
    paymentCredentialIdx: index('txo_payment_credential_idx').on(table.paymentCredential),
  }),
)

// Define relations for transactionOutput
export const transactionOutputsRelations = relations(transactionOutputs, ({one}) => ({
  block: one(blocks, {fields: [transactionOutputs.slot], references: [blocks.slot]}),
  spendBlock: one(blocks, {fields: [transactionOutputs.spendSlot], references: [blocks.slot]}),
  transaction: one(transactions, {
    fields: [transactionOutputs.txHash],
    references: [transactions.txHash],
  }),
}))

// We stringify the JSONB structure before adding to the buffer to prevent null-byte error in the unnest interpolation
export type NewTxOutput = Omit<typeof transactionOutputs.$inferInsert, 'ogmiosUtxo'> & {
  ogmiosUtxo: string
}
