import {config} from './config'
import {logger} from './logger'
import {startChainSyncClient} from './ogmios/chainSync'
import {getContext} from './ogmios/ogmios'
import {app} from './server'

// First we need to get the Ogmios interaction context
// It's needed for both the chain synchronization client and the HTTP server
await getContext()

if (config.MODE === 'aggregation' || config.MODE === 'both') {
	// Start the Ogmios chain synchornization client
	startChainSyncClient()
}

if (config.MODE === 'server' || config.MODE === 'both') {
	// Start the HTTP server, by default on port 3000
	app.listen(config.PORT)
	logger.info(`Server listening on http://localhost:${config.PORT}`)
}
