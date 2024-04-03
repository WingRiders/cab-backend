import {Elysia, t} from 'elysia'
import {config} from './config'
import {getUTxOs} from './ogmios'

export const app = new Elysia()
	// Transform query parameters with `,` to an array
	.derive(({query}) => ({
		query: Object.fromEntries(
			Object.entries(query).map(([k, v]) => [k, v?.includes(',') ? v?.split(',') : v]),
		),
	}))

	// Get health of the service
	.get('/healthcheck', () => ({healthy: true, uptime: process.uptime()}))

	// Get UTxOs for given addresses, optionally tied to a specific slot
	.get('/utxos', ({query}) => getUTxOs(query), {
		query: t.Object({addresses: t.Array(t.String())}),
	})

	// Get stake key info - rewards, delegated, stake pool id
	.get('/rewardAccountSummary/:stakeKeyHash', ({params: stakeKeyHash}) => 'TODO')

	// Get protocol params - can be cached for whole epoch / or till a protocol params tx is onchain
	.get('/protocolParameters', () => 'TODO')

	// Gets list of used addresses for given stakeKeyHash
	.get('/addresses/:stakeKeyHash', ({params: {stakeKeyHash}}) => 'TODO')

	// Submit a TX - non-blocking - don't wait for TX delivery
	.post('/submitTx', () => 'TODO')

	// Check if TX is on blockchain
	.get('/checkTx/{txHash}', ({params: txHash}) => 'TODO')

	// Listen on configured port, defaults to 3000
	.listen(config.PORT)
