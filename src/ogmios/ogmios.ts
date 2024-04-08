import {createInteractionContext} from '@cardano-ogmios/client'
import {config} from '../config'
import {logger} from '../logger'

let context: Awaited<ReturnType<typeof createInteractionContext>> | undefined
export const getContext = async () => {
	// If the context is undefind, or the connection is closing (2) or closed (3) (re)create the context
	if (!context || context.socket.readyState > 1) {
		logger.info('Ogmios - opening new connection')
		try {
			context = await createInteractionContext(
				(err) => logger.error(err),
				() => logger.warn('Ogmios - connection closed'),
				{
					connection: {
						host: config.OGMIOS_HOST,
						port: config.OGMIOS_PORT,
					},
				},
			)
		} catch (e) {
			// If we are unable to create the Ogmios interaction context let the process fail
			logger.error(e, 'Ogmios - error while opening new connection')
			process.exit(1)
		}
	}

	return context
}

export const withClient =
	<C>(clientPromise: () => Promise<C>) =>
	async <R>(f: (client: C) => Promise<R>): Promise<R> =>
		f(await clientPromise())
