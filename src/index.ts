import prexit from 'prexit'
import {config} from './config'
import {sql} from './db/db'
import {migrateDb} from './db/migrate'
import {logger} from './logger'
import {startChainSyncClient} from './ogmios/chainSync'
import {getContext} from './ogmios/ogmios'
import {app, baseApp} from './server'

// First we need to get the Ogmios interaction context
// It's needed for both the chain synchronization client and the HTTP server
await getContext()

if (config.MODE === 'aggregator' || config.MODE === 'both') {
  // Before starting the aggregator run the database migrations
  await migrateDb()

  // Start the Ogmios chain synchornization client
  startChainSyncClient()

  // Start the base HTTP server with /healthstatus endpoint
  // if the mode is 'both' the server will be started later
  if (config.MODE !== 'both') {
    baseApp.listen(config.PORT)
    logger.info(`Server listening on http://localhost:${config.PORT}`)
  }
}

if (config.MODE === 'server' || config.MODE === 'both') {
  // Start the HTTP server, by default on port 3000
  app.listen(config.PORT)
  logger.info(`Server listening on http://localhost:${config.PORT}`)
}

prexit(async () => {
  logger.info('Shutting down')
  await sql.end({timeout: 5})
})
