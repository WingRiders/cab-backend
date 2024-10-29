import {createChainSynchronizationClient} from '@cardano-ogmios/client'
import type {BlockPraos, Point, Transaction} from '@cardano-ogmios/schema'
import {and, desc, gte, lt} from 'drizzle-orm'
import {stringify} from 'json-bigint'
import {db, sql} from '../db/db'
import {
  type NewAddress,
  type NewBlock,
  type NewTx,
  type NewTxOutput,
  addresses,
  blocks,
  transactionOutputs,
  transactions,
} from '../db/schema'
import {bechAddressToHex, originPoint} from '../helpers.ts'
import {logger} from '../logger'
import {getContext} from './ogmios'

// Buffering is suitable when doing the initial sync
const BUFFER_SIZE = 10_000
const IMMUTABLE_BLOCKS_AGE_IN_SLOTS = 172_800 // 2 days

const isShelleyAddress = (address: string) => address.startsWith('addr')

// Aggregation logic is here
const processBlock = async (block: BlockPraos) => {
  blockBuffer.push({slot: block.slot, hash: Buffer.from(block.id, 'hex'), height: block.height})

  const transactions: Transaction[] = block.transactions ?? []
  transactions.map((tx) => {
    const newTx: NewTx = {txHash: Buffer.from(tx.id, 'hex'), slot: block.slot}
    txBuffer.push(newTx)

    let outputIndex = 0
    for (const output of tx.outputs) {
      if (!isShelleyAddress(output.address)) {
        // We don't aggregate Byron addresses
        continue
      }
      const newAddress: NewAddress = {
        address: bechAddressToHex(output.address),
        firstSlot: block.slot,
      }
      addressBuffer.push(newAddress)

      const newTxOutput: NewTxOutput = {
        utxoId: `${tx.id}#${outputIndex}`,
        slot: block.slot,
        spendSlot: null,
        address: output.address,
        ogmiosUtxo: stringify({transaction: {id: tx.id}, index: outputIndex, ...output}),
      }
      txOutputBuffer.push(newTxOutput)

      outputIndex += 1
    }

    const spentTxOutputs = tx.inputs.map((input) => ({
      utxoId: `${input.transaction.id}#${input.index}`,
      spendSlot: block.slot,
    }))
    spentTxOutputBuffer.push(...spentTxOutputs)
  })
}

const processRollback = async (point: 'origin' | Point) => {
  const rollbackSlot = point === 'origin' ? originPoint.slot : point.slot
  await db.transaction((tx) =>
    Promise.all([
      tx.delete(blocks).where(gte(blocks.slot, rollbackSlot)),
      tx.delete(transactions).where(gte(transactions.slot, rollbackSlot)),
      tx.delete(addresses).where(gte(addresses.firstSlot, rollbackSlot)),
      tx.delete(transactionOutputs).where(gte(transactionOutputs.slot, rollbackSlot)),
      tx
        .update(transactionOutputs)
        .set({spendSlot: null})
        .where(
          and(
            gte(transactionOutputs.spendSlot, rollbackSlot),
            lt(transactionOutputs.slot, rollbackSlot),
          ),
        ),
    ]),
  )
}

// Aggregation framework below
let blockBuffer: NewBlock[] = []
let txBuffer: NewTx[] = []
let addressBuffer: NewAddress[] = []
let txOutputBuffer: NewTxOutput[] = []
let spentTxOutputBuffer: {utxoId: string; spendSlot: number}[] = []

// Write buffers into DB
const writeBuffersIfNecessary = async ({
  latestLedgerHeight,
  threshold,
  rollbackToSlot,
}: {
  latestLedgerHeight?: number
  threshold: number
  rollbackToSlot?: number
}) => {
  // If one buffer is being written others must as well as they might depend on each other
  // For example block determines in case of restarts the intersect for resuming
  // chain sync. If block buffer was written but other data not, it could get lost forever.
  if (
    blockBuffer.length >= threshold ||
    txBuffer.length >= threshold ||
    addressBuffer.length >= threshold ||
    txOutputBuffer.length >= threshold ||
    spentTxOutputBuffer.length >= threshold
  ) {
    const latestBlock = blockBuffer[blockBuffer.length - 1]
    const latestSlot = latestBlock?.slot
    const statsBeforeDbWrite = {
      blocks: blockBuffer.length,
      transactions: txBuffer.length,
      addresses: addressBuffer.length,
      transactionOutputs: txOutputBuffer.length,
      txOutputsToSpend: spentTxOutputBuffer.length,
      latestSlot,
      ...(latestLedgerHeight ? {progress: (latestBlock?.height || 1) / latestLedgerHeight} : {}),
      rollbackToSlot,
    }

    logger.debug(statsBeforeDbWrite, 'Start writing buffers to DB')

    // Stats which will be set in the SQL transaction
    const stats = {
      ...statsBeforeDbWrite,
      newAddresses: 0,
      spentTxOutputs: 0,
      deletedImmutablySpentTxOutputs: 0,
      utxoSet: 0,
      spentTxos: 0,
    }

    // Do the inserts in one transaction to ensure data doesn't get corrupted if the
    // execution fails somewhere
    await sql.begin(async (sql) => {
      // Inserting data with unnest ensures that the query is stable and reduces the
      // amount of time it takes to parse the query.
      await sql`
          INSERT INTO block (slot, hash, height)
          SELECT *
          FROM unnest(
                  ${sql.array(blockBuffer.map(({slot}) => slot))}::integer[],
                  ${sql.array(blockBuffer.map(({hash}) => hash))}::bytea[],
                  ${sql.array(blockBuffer.map(({height}) => height))}::integer[])`

      if (txBuffer.length > 0) {
        await sql`
            INSERT INTO transaction (tx_hash, slot)
            SELECT *
            FROM unnest(
                    ${sql.array(txBuffer.map(({txHash}) => txHash))}::bytea[],
                    ${sql.array(txBuffer.map(({slot}) => slot))}::integer[])`

        // Addresses might repeat, so `ON CONFLICT DO NOTHING` skips any duplicates and keeps
        // the first address only in the DB
        const newAddresses = await sql`
            INSERT INTO address (address, first_slot)
            SELECT *
            FROM unnest(
                    ${sql.array(addressBuffer.map(({address}) => address))}::bytea[],
                    ${sql.array(addressBuffer.map(({firstSlot}) => firstSlot))}::integer[])
            ON CONFLICT DO NOTHING`
        stats.newAddresses = newAddresses.count

        if (txOutputBuffer.length > 0) {
          await sql`
              INSERT INTO transaction_output (utxo_id, slot, spend_slot, address, ogmios_utxo)
              SELECT *
              FROM unnest(
                      ${sql.array(txOutputBuffer.map(({utxoId}) => utxoId))}::varchar[],
                      ${sql.array(txOutputBuffer.map(({slot}) => slot))}::integer[],
                      ${sql.array(txOutputBuffer.map(({spendSlot}) => spendSlot ?? null))}::integer[],
                      ${sql.array(txOutputBuffer.map(({address}) => address))}::varchar[],
                      ${sql.array(txOutputBuffer.map(({ogmiosUtxo}) => ogmiosUtxo))}::jsonb[]
                   )`
        }
        if (spentTxOutputBuffer.length > 0) {
          const spentTxOutputs = await sql`
              UPDATE transaction_output
              SET spend_slot = u.spendSlot
              FROM (SELECT unnest(${sql.array(spentTxOutputBuffer.map(({utxoId}) => utxoId))}::varchar[])              AS utxo_id,
                           unnest(${sql.array(spentTxOutputBuffer.map(({spendSlot}) => spendSlot))}::integer[]) AS spendSlot) AS u
              WHERE transaction_output.utxo_id = u.utxo_id;`
          stats.spentTxOutputs = spentTxOutputs.count
        }
      }

      const unspent = await sql`
          SELECT COUNT(*)
          FROM transaction_output
          WHERE spend_slot IS NULL`
      const spent = await sql`
          SELECT COUNT(*)
          FROM transaction_output
          WHERE spend_slot IS NOT NULL`

      if (latestSlot && !rollbackToSlot) {
        const deletedImmutablySpentTxOutputs = await sql`
            WITH deleted
                     AS (DELETE FROM transaction_output WHERE spend_slot < ${
                       latestSlot - IMMUTABLE_BLOCKS_AGE_IN_SLOTS
                     } RETURNING *)
            SELECT COUNT(*) as count
            FROM deleted`
        stats.deletedImmutablySpentTxOutputs = deletedImmutablySpentTxOutputs[0]?.count
      }

      stats.utxoSet = unspent[0]?.count
      stats.spentTxos = spent[0]?.count
    })

    logger.info(stats, 'Wrote buffers to DB')

    blockBuffer = []
    txBuffer = []
    addressBuffer = []
    txOutputBuffer = []
    spentTxOutputBuffer = []
  }
}

// Find starting point for Ogmios, either 10th latest block (to prevent issues in case of
// rollbacks) or default to origin
const findIntersect = async () => {
  const dbBlock = await db.query.blocks.findFirst({orderBy: [desc(blocks.slot)], offset: 10})
  return dbBlock ? {id: dbBlock.hash.toString('hex'), slot: dbBlock.slot} : originPoint
}

// Start the chain sync client, and add a listener on the underlying socket - connection to Ogmios
// If that closes try to restart the chain sync again
export const startChainSyncClient = async () => {
  // Before starting flush the buffers, required in case of restarts to get rid of stale
  // data and prevent double writes
  blockBuffer = []
  txBuffer = []
  addressBuffer = []
  txOutputBuffer = []
  spentTxOutputBuffer = []

  const context = await getContext()

  const chainSyncClient = await createChainSynchronizationClient(context, {
    async rollForward(response, nextBlock) {
      // Skip Byron blocks, we are not interested in those addresses
      if (response.block.era !== 'byron') {
        logger.trace(
          {slot: response.block.slot, height: response.block.height, era: response.block.era},
          'Roll forward',
        )

        await processBlock(response.block)

        // Decide if to use buffering based on proximity to ledger tip
        if (response.tip !== 'origin' && response.tip.height - 10 < response.block.height) {
          await writeBuffersIfNecessary({latestLedgerHeight: response.tip.height, threshold: 1})
        } else {
          await writeBuffersIfNecessary({
            latestLedgerHeight:
              response.tip === 'origin' ? originPoint.height : response.tip.height,
            threshold: BUFFER_SIZE,
          })
        }
      }
      nextBlock()
    },

    async rollBackward(response, nextBlock) {
      logger.trace({point: response.point}, 'Roll backward')
      await writeBuffersIfNecessary({
        threshold: 1,
        rollbackToSlot: response.point === 'origin' ? originPoint.slot : response.point.slot,
      })
      await processRollback(response.point)
      nextBlock()
    },
  })

  // Start the chain sync client from the latest intersect, and rollback to it first
  const intersect = await findIntersect()
  await processRollback(intersect)
  logger.info({intersect}, 'Ogmios - resuming chainSyncClient')
  await chainSyncClient.resume([intersect], 100)

  // Restart chainSyncClient on context close
  context.socket.addEventListener('close', () => startChainSyncClient())
}
