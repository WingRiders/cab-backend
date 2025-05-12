import {and, desc, sql as dsql, eq, gt, inArray, isNotNull, isNull, or} from 'drizzle-orm'
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

type UtxoQueryOptions = {
  limit?: number
  lastSeenUtxoId?: string
  hasOneOfTokens?: {policyId: string; assetName: string}[]
  mustHaveDatum?: boolean
  includeTxIndex?: boolean
}

const utxosByColumnValues = async (
  column: PgColumn,
  values: string[] | Buffer[],
  utxoQueryOptions?: UtxoQueryOptions,
) => {
  const tokenConditions =
    utxoQueryOptions?.hasOneOfTokens?.map(
      ({policyId, assetName}) =>
        dsql`jsonb_path_exists(${
          schema.transactionOutputs.ogmiosUtxo
        }, ${`$.value."${policyId}"."${assetName}"`})`,
    ) ?? []

  const createBaseQuery = () => {
    const query = db
      .select({
        slot: schema.transactionOutputs.slot,
        ogmiosUtxo: schema.transactionOutputs.ogmiosUtxo,
        ...(utxoQueryOptions?.includeTxIndex ? {txIndex: schema.transactions.txIndex} : {}),
      })
      .from(schema.transactionOutputs)

    return utxoQueryOptions?.includeTxIndex
      ? query.innerJoin(
          schema.transactions,
          eq(schema.transactions.txHash, schema.transactionOutputs.txHash),
        )
      : query
  }

  const runQuery = (baseQuery: ReturnType<typeof createBaseQuery>) => {
    const query = baseQuery
      .where(
        and(
          inArray(column, values),
          isNull(schema.transactionOutputs.spendSlot),
          utxoQueryOptions?.lastSeenUtxoId
            ? gt(schema.transactionOutputs.utxoId, utxoQueryOptions.lastSeenUtxoId)
            : undefined,
          utxoQueryOptions?.mustHaveDatum
            ? isNotNull(dsql`${schema.transactionOutputs.ogmiosUtxo}->'datum'`)
            : undefined,
          or(...tokenConditions),
        ),
      )
      .orderBy(schema.transactionOutputs.utxoId)

    return (utxoQueryOptions?.limit ? query.limit(utxoQueryOptions.limit) : query).execute()
  }

  const utxos = await runQuery(createBaseQuery())
  return utxos.map(({slot, ogmiosUtxo, txIndex}) => ({slot, ...(ogmiosUtxo as object), txIndex}))
}

export const utxosByAddresses = (addresses: string[], utxoQueryOptions?: UtxoQueryOptions) =>
  utxosByColumnValues(schema.transactionOutputs.address, addresses, utxoQueryOptions)

export const utxosByReferences = (utxoIds: string[], utxoQueryOptions?: UtxoQueryOptions) =>
  utxosByColumnValues(schema.transactionOutputs.utxoId, utxoIds, utxoQueryOptions)

export const utxosByScriptHashes = (scriptHashes: string[], utxoQueryOptions?: UtxoQueryOptions) =>
  utxosByColumnValues(
    schema.transactionOutputs.paymentCredential,
    scriptHashes.map((hash) => Buffer.from(hash, 'hex')),
    utxoQueryOptions,
  )
