import {createChainSynchronizationClient} from '@cardano-ogmios/client'
import {getContext} from './ogmios'
import {logger} from '../logger'

export const startChainSyncClient = async () => {
	const context = await getContext()

	const chainSyncClient = await createChainSynchronizationClient(context, {
		async rollForward(response, nextBlock) {
			// Skip Byron blocks, we are not interested in those addresses
			if (response.block.era !== 'byron') {
				logger.debug({slot: response.block.height, era: response.block.era}, 'Roll forward')
			}
			nextBlock()
		},

		async rollBackward(response, nextBlock) {
			logger.debug({point: response.point}, 'Roll backward')
			nextBlock()
		},
	})

	// Start the chain sync client from the origin, roll forward skips byron blocks
	logger.info('Ogmios - resuming chainSyncClient')
	await chainSyncClient.resume(['origin'])

	// Restart chainSyncClient on context close
	context.socket.addEventListener('close', () => startChainSyncClient())
}
