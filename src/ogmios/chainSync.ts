import {createChainSynchronizationClient} from '@cardano-ogmios/client'
import type {BlockPraos, Point} from '@cardano-ogmios/schema'
import {desc, gte} from 'drizzle-orm'
import {db, sql} from '../db/db'
import {type NewBlock, blocks} from '../db/schema'
import {logger} from '../logger'
import {getContext} from './ogmios'

// Aggregation logic is here
const processBlock = async (block: BlockPraos) => {
	blockBuffer.push({slot: block.slot, hash: Buffer.from(block.id, 'hex')})
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

// Write buffer of blocks into DB
const writeBufferIfNecessary = async (threshold = bufferSize) => {
	if (blockBuffer.length >= threshold) {
		// Inserting data with unnest ensures that the query is stable and reduces the
		// amount of time it takes to parse the query.
		await sql`INSERT INTO block (slot, hash) SELECT * FROM unnest(${blockBuffer.map(
			({slot}) => slot,
		)}::integer[], ${sql.array(blockBuffer.map(({hash}) => hash))}::bytea[])`
		logger.debug(`Inserted ${blockBuffer.length} blocks into DB`)

		blockBuffer = []
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
	// Before starting flush the block buffer, required in case of restarts to get rid of stale
	// blocks and prevent double writes
	blockBuffer = []

	const context = await getContext()

	const chainSyncClient = await createChainSynchronizationClient(context, {
		async rollForward(response, nextBlock) {
			// Skip Byron blocks, we are not interested in those addresses
			if (response.block.era !== 'byron') {
				logger.trace({slot: response.block.height, era: response.block.era}, 'Roll forward')

				await processBlock(response.block)

				// Decide if to use buferring based on proximity to ledger tip
				if (response.tip !== 'origin' && response.tip.height - 10 < response.block.height) {
					await writeBufferIfNecessary(1)
				} else {
					await writeBufferIfNecessary()
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
