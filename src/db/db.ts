import {and, desc, sql as dsql, eq, inArray, isNull} from 'drizzle-orm'
import type {PgColumn} from 'drizzle-orm/pg-core'
import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {bechAddressToHex} from '../helpers.ts'
import {dbConnectionOptions} from './config'
import * as schema from './schema'

// Open a connection
export const sql = postgres(dbConnectionOptions)
export const db = drizzle(sql, {schema})

// Queries
export const getLastBlock = () => db.query.blocks.findFirst({orderBy: [desc(schema.blocks.slot)]})

export const transactionByTxHash = (txHash: string) =>
  db.query.transactions.findFirst({
    where: eq(schema.transactions.txHash, Buffer.from(txHash, 'hex')),
    with: {block: {columns: {height: true, hash: true}}},
  })

export const addressesByStakeKeyHash = (stakeKeyHash: string) =>
  db.query.addresses.findMany({
    where: dsql`substr(${schema.addresses},30,28)=${Buffer.from(stakeKeyHash, 'hex')}`,
  })

export const filterUsedAddresses = (addresses: string[]) =>
  db.query.addresses.findMany({
    where: inArray(schema.addresses.address, addresses.map(bechAddressToHex)),
  })

const utxosByColumnValues = async (column: PgColumn, values: string[]) => {
  const txOutputs = await db.query.transactionOutputs.findMany({
    where: and(inArray(column, values), isNull(schema.transactionOutputs.spendSlot)),
  })
  return txOutputs.map(({ogmiosUtxo}) => ogmiosUtxo)
}
export const utxosByAddresses = (addresses: string[]) =>
  utxosByColumnValues(schema.transactionOutputs.address, addresses)

export const utxosByReferences = (utxoIds: string[]) =>
  utxosByColumnValues(schema.transactionOutputs.utxoId, utxoIds)
