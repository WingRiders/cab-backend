import prexit from 'prexit'
import {config} from './config'
import {sql} from './db/db'
import {migrateDb} from './db/migrate'
import {logger} from './logger'
import {chainSyncOgmiosClient} from './ogmios/chainSync'
import {ledgerStateQueryOgmiosClient} from './ogmios/ledgerStateQuery'
import {type OgmiosClient, ogmiosClientsInitializerLoop} from './ogmios/ogmios'
import {txSubmissionOgmiosClient} from './ogmios/submit'
import {app, baseApp} from './server'

// The ledger state query client is needed in every mode, /healthcheck queries the tips with it
const ogmiosClients: OgmiosClient[] = [ledgerStateQueryOgmiosClient]

if (config.MODE === 'server' || config.MODE === 'both') {
  ogmiosClients.push(txSubmissionOgmiosClient)
}

if (config.MODE === 'aggregator' || config.MODE === 'both') {
  // Before starting the aggregator run the database migrations
  await migrateDb()

  // The Ogmios chain synchronization client, it resumes on every new connection
  ogmiosClients.push(chainSyncOgmiosClient)

  // Start the base HTTP server with /healthstatus endpoint
  // if the mode is 'both' the server will be started later
  if (config.MODE !== 'both') {
    baseApp.listen(config.PORT)
    logger.info(`Server listening on http://localhost:${config.PORT}`)
  }
}

// Opens the Ogmios connection, initializes the clients on it and reconnects after every close
ogmiosClientsInitializerLoop(ogmiosClients)

if (config.MODE === 'server' || config.MODE === 'both') {
  // Start the HTTP server, by default on port 3000
  app.listen(config.PORT)
  logger.info(`Server listening on http://localhost:${config.PORT}`)
}

prexit(async () => {
  logger.info('Shutting down')
  await sql.end({timeout: 5})
})
