import {createInteractionContext} from '@cardano-ogmios/client'
import {config} from '../config'

let context: Awaited<ReturnType<typeof createInteractionContext>> | undefined
export const getContext = async () => {
	// If the context is undefind, or the connection is closing (2) or closed (3) (re)create the context
	if (!context || context.socket.readyState > 1) {
		console.log('Opening new Ogmios connection')
		context = await createInteractionContext(
			(err) => console.error(err),
			() => console.log('Connection closed.'),
			{
				connection: {
					host: config.OGMIOS_HOST,
					port: config.OGMIOS_PORT,
				},
			},
		)
	}
	return context
}
