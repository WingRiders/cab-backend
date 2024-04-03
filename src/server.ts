import {Elysia, t} from 'elysia'
import JSONbig from 'json-bigint'
import {getUTxOs, protocolParameters, rewardAccountSummary} from './ogmios/ledgerStateQuery'

const {stringify} = JSONbig({useNativeBigInt: true})

export const app = new Elysia()
	// Handle encoding of bigints returned by Ogmios
	.mapResponse(({response}) => {
		if (typeof response === 'object') {
			return new Response(stringify(response), {headers: {'Content-Type': 'application/json'}})
		}
	})

	// Get health of the service
	.get('/healthcheck', () => ({healthy: true, uptime: process.uptime()}))

	// Get UTxOs for given addresses, optionally tied to a specific slot
	// POST is not correct in terms of REST, but easier to handle array params
	.post('/utxos', ({body: {addresses}}) => getUTxOs({addresses}), {
		body: t.Object({addresses: t.Array(t.String())}),
	})

	// Get stake key info - rewards, delegated, stake pool id
	.get('/rewardAccountSummary/:stakeKeyHash', ({params: {stakeKeyHash}}) =>
		rewardAccountSummary(stakeKeyHash),
	)

	// Get protocol params - cached for whole epoch
	.get('/protocolParameters', () => protocolParameters())

	// Gets list of used addresses for given stakeKeyHash
	.get('/addresses/:stakeKeyHash', ({params: {stakeKeyHash}}) => 'TODO')

	// Submit a TX - non-blocking - don't wait for TX delivery
	.post('/submitTx', () => 'TODO')

	// Check if TX is on blockchain
	.get('/checkTx/{txHash}', ({params: txHash}) => 'TODO')
