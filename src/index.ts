import {config} from './config'
import {startChainSyncClient} from './ogmios/chainSync'
import {app} from './server'

// Start the HTTP server, by default on port 3000
app.listen(config.PORT)

// Start the Ogmios chain synchornization client
startChainSyncClient()
