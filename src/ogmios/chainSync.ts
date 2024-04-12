import {createChainSynchronizationClient} from '@cardano-ogmios/client'
import type {BlockPraos, Point} from '@cardano-ogmios/schema'
import {bech32} from 'bech32'
import {desc, gte} from 'drizzle-orm'
import {db, sql} from '../db/db'
import {
  type NewAddress,
  type NewBlock,
  type NewTx,
  blocks,
  transactions,
  addresses,
} from '../db/schema'
import {logger} from '../logger'
import {getContext} from './ogmios'

// Aggregation logic is here
const processBlock = async (block: BlockPraos) => {
  blockBuffer.push({slot: block.slot, hash: Buffer.from(block.id, 'hex'), height: block.height})

  const txHashes = block.transactions?.map((tx) => tx.id) || []
  txBuffer.push(
    ...txHashes.map<NewTx>((txHash) => ({txHash: Buffer.from(txHash, 'hex'), slot: block.slot})),
  )

  // Shelley addresses - bech32 with prefix starting with addr/addr_test
  const addresses = (
    block.transactions?.flatMap((tx) => tx.outputs.map((output) => output.address)) || []
  ).filter((address) => address.startsWith('addr'))
  addressBuffer.push(
    ...addresses.map<NewAddress>((address) => ({
      address: Buffer.from(bech32.fromWords(bech32.decode(address, 114).words)),
      firstSlot: block.slot,
    })),
  )
}

const processRollback = async (point: 'origin' | Point) => {
  const rollbackSlot = point === 'origin' ? 0 : point.slot
  await db.transaction((tx) =>
    Promise.all([
      tx.delete(blocks).where(gte(blocks.slot, rollbackSlot)),
      tx.delete(transactions).where(gte(transactions.slot, rollbackSlot)),
      tx.delete(addresses).where(gte(addresses.firstSlot, rollbackSlot)),
    ]),
  )
}

// Aggregation framework below
// Buffering is suitable when doing the initial sync
const bufferSize = 10_000
let blockBuffer: NewBlock[] = []
let txBuffer: NewTx[] = []
let addressBuffer: NewAddress[] = []

// Write buffers into DB
const writeBuffersIfNecessary = async (latestHeight: number, threshold = bufferSize) => {
  // If one buffer is being written others must as well as they might depend on each other
  // For example block determines in case of restarts the intersect for resuming
  // chain sync. If block buffer was written but other data not, it could get lost forever.
  if (
    blockBuffer.length >= threshold ||
    txBuffer.length >= threshold ||
    addressBuffer.length >= threshold
  ) {
    const stats = {
      blocks: '0/0',
      transactions: '0/0',
      addresses: '0/0',
      progress: (blockBuffer[blockBuffer.length - 1]?.height || 1) / (latestHeight || 1),
    }

    // Do the inserts in one transaction to ensure data doesn't get corrupted if the
    // execution fails somewhere
    await sql.begin(async (sql) => {
      // Inserting data with unnest ensures that the query is stable and reduces the
      // amount of time it takes to parse the query.
      const blocks = await sql`INSERT INTO block (slot, hash, height) SELECT * FROM unnest(
          ${sql.array(blockBuffer.map(({slot}) => slot))}::integer[],
          ${sql.array(blockBuffer.map(({hash}) => hash))}::bytea[],
          ${sql.array(blockBuffer.map(({height}) => height))}::integer[])`
      stats.blocks = `${blocks.count}/${blockBuffer.length}`

      if (txBuffer.length > 0) {
        const txs = await sql`INSERT INTO transaction (tx_hash, slot) SELECT * FROM unnest(
            ${sql.array(txBuffer.map(({txHash}) => txHash))}::bytea[],
            ${sql.array(txBuffer.map(({slot}) => slot))}::integer[])`
        stats.transactions = `${txs.count}/${txBuffer.length}`

        // Addresses might repeat, so `ON CONFLICT DO NOTHING` skips any duplicates and keeps
        // the first address only in the DB
        const addresses = await sql`INSERT INTO address (address, first_slot) SELECT * FROM unnest(
            ${sql.array(addressBuffer.map(({address}) => address))}::bytea[],
            ${sql.array(addressBuffer.map(({firstSlot}) => firstSlot))}::integer[])
					ON CONFLICT DO NOTHING`
        stats.addresses = `${addresses.count}/${addressBuffer.length}`
      }
    })

    logger.info(stats, 'Wrote buffers to DB')

    blockBuffer = []
    txBuffer = []
    addressBuffer = []
  }
}

// Find starting point for Ogmios, either 10th latest block (to prevent issues in case of
// rollbacks) or default to origin
const findIntersect = async () => {
  const dbBlock = await db.query.blocks.findFirst({orderBy: [desc(blocks.slot)], offset: 10})
  return dbBlock ? {id: dbBlock.hash.toString('hex'), slot: dbBlock.slot} : 'origin'
}

// Start the chain sync client, and add a listener on the underlying socket - connection to Ogmios
// If that closes try to restart the chain sync again
export const startChainSyncClient = async () => {
  // Before starting flush the buffers, required in case of restarts to get rid of stale
  // data and prevent double writes
  blockBuffer = []
  txBuffer = []
  addressBuffer = []

  const context = await getContext()

  const chainSyncClient = await createChainSynchronizationClient(context, {
    async rollForward(response, nextBlock) {
      // Skip Byron blocks, we are not interested in those addresses
      if (response.block.era !== 'byron') {
        logger.trace({slot: response.block.height, era: response.block.era}, 'Roll forward')

        await processBlock(response.block)

        // Decide if to use buferring based on proximity to ledger tip
        if (response.tip !== 'origin' && response.tip.height - 10 < response.block.height) {
          await writeBuffersIfNecessary(response.tip.height, 1)
        } else {
          await writeBuffersIfNecessary(response.tip === 'origin' ? 0 : response.tip.height)
        }
      }
      nextBlock()
    },

    async rollBackward(response, nextBlock) {
      logger.trace({point: response.point}, 'Roll backward')
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
