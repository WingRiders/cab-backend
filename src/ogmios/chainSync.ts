import {createChainSynchronizationClient} from '@cardano-ogmios/client'
import type {BlockPraos, Point} from '@cardano-ogmios/schema'
import {desc, gte} from 'drizzle-orm'
import {db, sql} from '../db/db'
import {type NewBlock, blocks, type NewTx} from '../db/schema'
import {logger} from '../logger'
import {getContext} from './ogmios'

// Aggregation logic is here
const processBlock = async (block: BlockPraos) => {
	blockBuffer.push({slot: block.slot, hash: Buffer.from(block.id, 'hex')})
	txBuffer.push(
		...(block.transactions?.map((tx) => ({txHash: Buffer.from(tx.id, 'hex'), slot: block.slot})) ||
			[]),
	)
}

const processRollback = async (point: 'origin' | Point) => {
	if (point === 'origin') {
		await db.delete(blocks)
	} else {
		await db.delete(blocks).where(gte(blocks.slot, point.slot))
	}
}

// Aggregation framework below
// Buffering is suitable when doing the initial sync
const bufferSize = 1000
let blockBuffer: NewBlock[] = []
let txBuffer: NewTx[] = []

// Write buffers into DB
const writeBuffersIfNecessary = async (threshold = bufferSize) => {
	// If one buffer is being written others must as well as they might depend on each other
	// For example block determines in case of restarts the intersect for resuming
	// chain sync. If block buffer was written but other data not, it could get lost forever.
	if (blockBuffer.length >= threshold || txBuffer.length >= threshold) {
		// Inserting data with unnest ensures that the query is stable and reduces the
		// amount of time it takes to parse the query.
		await sql.begin((sql) => [
			sql`INSERT INTO block (slot, hash) SELECT * FROM unnest(${sql.array(
				blockBuffer.map(({slot}) => slot),
			)}::integer[], ${sql.array(blockBuffer.map(({hash}) => hash))}::bytea[])`,
			sql`INSERT INTO transaction (tx_hash, slot) SELECT * FROM unnest(${sql.array(
				txBuffer.map(({txHash}) => txHash),
			)}::bytea[], ${sql.array(txBuffer.map(({slot}) => slot))}::integer[])`,
		])

		logger.debug(`Inserted ${blockBuffer.length} blocks into DB`)
		logger.debug(`Inserted ${txBuffer.length} transactions into DB`)

		blockBuffer = []
		txBuffer = []
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

	const context = await getContext()

	const chainSyncClient = await createChainSynchronizationClient(context, {
		async rollForward(response, nextBlock) {
			// Skip Byron blocks, we are not interested in those addresses
			if (response.block.era !== 'byron') {
				logger.trace({slot: response.block.height, era: response.block.era}, 'Roll forward')

				await processBlock(response.block)

				// Decide if to use buferring based on proximity to ledger tip
				if (response.tip !== 'origin' && response.tip.height - 10 < response.block.height) {
					await writeBuffersIfNecessary(1)
				} else {
					await writeBuffersIfNecessary()
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
	processRollback(intersect)
	logger.info({intersect}, 'Ogmios - resuming chainSyncClient')
	await chainSyncClient.resume([intersect], bufferSize)

	// Restart chainSyncClient on context close
	context.socket.addEventListener('close', () => startChainSyncClient())
}
