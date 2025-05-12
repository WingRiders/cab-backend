import {createChainSynchronizationClient} from '@cardano-ogmios/client'
import type {BlockPraos, Point, Transaction} from '@cardano-ogmios/schema'
import {and, desc, eq, gt, inArray, isNull, lt, lte} from 'drizzle-orm'
import {stringify} from 'json-bigint'
import {config} from '../config.ts'
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
import {bechAddressToHex, originPoint, paymentCredentialFromAddress} from '../helpers.ts'
import {logger} from '../logger'
import {getContext} from './ogmios'

// Buffering is suitable when doing the initial sync
const BUFFER_SIZE = 1_000
const IMMUTABLE_BLOCKS_AGE_IN_SLOTS = 172_800 // 2 days

const isShelleyAddress = (address: string) => address.startsWith('addr')

// Aggregation logic is here
const processBlock = async (block: BlockPraos) => {
  if (
    config.FIXUP_MISSING_BLOCKS.size > 0 &&
    !config.FIXUP_MISSING_BLOCKS.has(block.height) &&
    originalIntersectSlot &&
    block.slot <= originalIntersectSlot
  ) {
    // In fixup mode: Do nothing for blocks that are not missing
    return
  }
  blockBuffer.push({slot: block.slot, hash: Buffer.from(block.id, 'hex'), height: block.height})

  const transactions: Transaction[] = block.transactions ?? []
  transactions.map((tx, txIndex) => {
    const newTx: NewTx = {txHash: Buffer.from(tx.id, 'hex'), slot: block.slot, txIndex}
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

      const utxoId = `${tx.id}#${outputIndex}`
      const datum =
        output.datum ?? (output.datumHash != null ? tx.datums?.[output.datumHash] : undefined)
      const newTxOutput: NewTxOutput = {
        utxoId,
        txHash: Buffer.from(tx.id, 'hex'),
        slot: block.slot,
        spendSlot: null,
        address: output.address,
        paymentCredential: paymentCredentialFromAddress(output.address),
        ogmiosUtxo: stringify({transaction: {id: tx.id}, index: outputIndex, ...output, datum}),
      }
      txOutputBuffer.push(newTxOutput)
      if (config.FIXUP_MISSING_BLOCKS.size > 0) {
        fixupUtxoIds.add(utxoId)
      }

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
  logger.info(point, 'Rollback')
  const rollbackSlot = point === 'origin' ? originPoint.slot : point.slot
  if (
    config.FIXUP_MISSING_BLOCKS.size > 0 &&
    originalIntersectSlot &&
    rollbackSlot < originalIntersectSlot
  ) {
    logger.info({originalIntersectSlot}, "Fixup - Won't delete blocks before originalIntersectSlot")
    return
  }
  await db.transaction((tx) =>
    Promise.all([
      tx.delete(blocks).where(gt(blocks.slot, rollbackSlot)),
      tx.delete(transactions).where(gt(transactions.slot, rollbackSlot)),
      tx.delete(addresses).where(gt(addresses.firstSlot, rollbackSlot)),
      tx.delete(transactionOutputs).where(gt(transactionOutputs.slot, rollbackSlot)),
      tx
        .update(transactionOutputs)
        .set({spendSlot: null})
        .where(
          and(
            gt(transactionOutputs.spendSlot, rollbackSlot),
            lte(transactionOutputs.slot, rollbackSlot),
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
// Tx outputs of filled blocks to help deciding when to set spend_slot
let fixupUtxoIds: Set<string> = new Set()
// Where to stop fixup and start processing full blocks
let originalIntersectSlot: number | null

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
                  ${sql.array(blockBuffer.map(({height}) => height))}::integer[])
          ON CONFLICT DO NOTHING`

      if (txBuffer.length > 0) {
        await sql`
            INSERT INTO transaction (tx_hash, slot, tx_index)
            SELECT *
            FROM unnest(
                    ${sql.array(txBuffer.map(({txHash}) => txHash))}::bytea[],
                    ${sql.array(txBuffer.map(({slot}) => slot))}::integer[],
                    ${sql.array(txBuffer.map(({txIndex}) => txIndex))}::integer[])
            ON CONFLICT DO NOTHING`

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
              INSERT INTO transaction_output (utxo_id, tx_hash, slot, spend_slot, address, ogmios_utxo, payment_credential)
              SELECT *
              FROM unnest(
                      ${sql.array(txOutputBuffer.map(({utxoId}) => utxoId))}::varchar[],
                      ${sql.array(txOutputBuffer.map(({txHash}) => txHash))}::bytea[],
                      ${sql.array(txOutputBuffer.map(({slot}) => slot))}::integer[],
                      ${sql.array(txOutputBuffer.map(({spendSlot}) => spendSlot ?? null))}::integer[],
                      ${sql.array(txOutputBuffer.map(({address}) => address))}::varchar[],
                      ${sql.array(txOutputBuffer.map(({ogmiosUtxo}) => ogmiosUtxo))}::jsonb[],
                      ${sql.array(txOutputBuffer.map(({paymentCredential}) => paymentCredential))}::bytea[]
                   )
              ON CONFLICT DO NOTHING`
        }
        if (spentTxOutputBuffer.length > 0) {
          const spentTxOutputs = await sql`
              UPDATE transaction_output
              SET spend_slot = u.spendSlot
              FROM (SELECT unnest(${sql.array(spentTxOutputBuffer.map(({utxoId}) => utxoId))}::varchar[])       AS utxo_id,
                           unnest(${sql.array(spentTxOutputBuffer.map(({spendSlot}) => spendSlot))}::integer[]) AS spendSlot) AS u
              WHERE transaction_output.utxo_id = u.utxo_id;`
          stats.spentTxOutputs = spentTxOutputs.count
        }
      }

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
// rollbacks or default to origin
const findIntersect = async () => {
  const dbBlock = await db.query.blocks.findFirst({orderBy: [desc(blocks.slot)], offset: 10})
  return dbBlock ? {id: dbBlock.hash.toString('hex'), slot: dbBlock.slot} : originPoint
}

// Find starting point for Ogmios, last block before the first missing block
// Can be overridden by continueFromHeight
const findIntersectForFixup = async (
  oldestMissingBlockHeight: number,
  continueFromHeight?: number,
) => {
  logger.trace({oldestMissingBlockHeight, continueFromHeight}, 'findIntersectForFixup')
  const dbBlock = await db.query.blocks.findFirst({
    where: lt(blocks.height, continueFromHeight ?? oldestMissingBlockHeight),
    orderBy: [desc(blocks.slot)],
  })
  return dbBlock ? {id: dbBlock.hash.toString('hex'), slot: dbBlock.slot} : originPoint
}

let hasCloseEventListener = false

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

  if (config.FIXUP_MISSING_BLOCKS.size > 0) {
    const utxoIdsInFilledBlocks = await db
      .select({utxoId: transactionOutputs.utxoId})
      .from(transactionOutputs)
      .innerJoin(blocks, eq(transactionOutputs.slot, blocks.slot))
      .where(
        and(
          inArray(blocks.height, [...config.FIXUP_MISSING_BLOCKS]),
          isNull(transactionOutputs.spendSlot),
        ),
      )
    logger.info(`Fixup - initializing fixupUtxoIds with ${utxoIdsInFilledBlocks.length} entries`)
    fixupUtxoIds = new Set(utxoIdsInFilledBlocks.map(({utxoId}) => utxoId))
  }

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

        const latestLedgerHeight =
          response.tip === 'origin' ? originPoint.height : response.tip.height

        // Decide if to use buffering based on proximity to ledger tip
        // No buffering in fixup mode
        const threshold =
          config.FIXUP_MISSING_BLOCKS.size > 0 ||
          (response.tip !== 'origin' && response.tip.height - 10 < response.block.height)
            ? 1
            : BUFFER_SIZE
        await writeBuffersIfNecessary({latestLedgerHeight, threshold})

        if (config.FIXUP_MISSING_BLOCKS.size > 0) {
          const spentUtxoIds =
            response.block.transactions?.flatMap((tx) =>
              tx.inputs.map((input) => `${input.transaction.id}#${input.index}`),
            ) ?? []
          const spentUtxoIdsInFixupBlocks = spentUtxoIds.filter((utxoId) =>
            fixupUtxoIds.has(utxoId),
          )
          if (spentUtxoIdsInFixupBlocks.length > 0) {
            logger.info(
              `Fixup - Setting spend_slot=${response.block.slot} for ${spentUtxoIdsInFixupBlocks.length} outputs in missing blocks`,
            )
            await db
              .update(transactionOutputs)
              .set({spendSlot: response.block.slot})
              .where(inArray(transactionOutputs.utxoId, spentUtxoIdsInFixupBlocks))
            for (const utxoId of spentUtxoIdsInFixupBlocks) {
              fixupUtxoIds.delete(utxoId)
            }
          }
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

  // Rollback to latest intersect first
  let intersect = await findIntersect()
  await processRollback(intersect)
  if (config.FIXUP_MISSING_BLOCKS.size > 0) {
    originalIntersectSlot = intersect.slot
    const oldestMissingBlockHeight = Math.min(...config.FIXUP_MISSING_BLOCKS)
    intersect = await findIntersectForFixup(
      oldestMissingBlockHeight,
      config.FIXUP_CONTINUE_FROM_HEIGHT,
    )
    logger.info({intersectForFixup: intersect, originalIntersectSlot}, 'Fixup - found intersects')
  }
  logger.info({intersect}, 'Ogmios - resuming chainSyncClient')
  await chainSyncClient.resume([intersect], 100)

  if (!hasCloseEventListener) {
    // Restart chainSyncClient on context close
    context.socket.addEventListener('close', () => startChainSyncClient())
    hasCloseEventListener = true
  }
}
