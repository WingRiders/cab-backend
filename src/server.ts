import {Elysia, t} from 'elysia'
import JSONbig from 'json-bigint'
import {
	getUTxOs,
	getLedgerTip,
	protocolParameters,
	rewardAccountSummary,
	getNetworkTip,
} from './ogmios/ledgerStateQuery'
import {addressesByStakeKeyHash, getLastBlock, transactionByTxHash} from './db/db'

const {stringify} = JSONbig({useNativeBigInt: true})

export const app = new Elysia()
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
	.get('/addresses/:stakeKeyHash', ({params: {stakeKeyHash}}) =>
		addressesByStakeKeyHash(stakeKeyHash),
	)

	// Check if TX is on blockchain
	.get('/transaction/:txHash', async ({params: {txHash}, set}) => {
		const transaction = await transactionByTxHash(txHash)
		if (!transaction) {
			set.status = 404
			return 'Not Found'
		}
		return transaction
	})

	// Submit a TX - non-blocking - don't wait for TX delivery
	.post('/submitTx', () => 'TODO')

	// Get health of the service
	.get('/healthcheck', async () => {
		// Check sync status
		const [networkSlot, ledgerSlot, lastBlockSlot] = await Promise.all([
			getNetworkTip().then((tip) => (tip === 'origin' ? 0 : tip.slot)),
			getLedgerTip().then((tip) => (tip === 'origin' ? 0 : tip.slot)),
			getLastBlock().then((block) => (block ? block.slot : 0)),
		])
		const healthyThresholdSlot = 10

		return {
			healthy:
				networkSlot - ledgerSlot < healthyThresholdSlot &&
				ledgerSlot - lastBlockSlot < healthyThresholdSlot,
			healthyThresholdSlot,
			networkSlot,
			ledgerSlot,
			lastBlockSlot,
			uptime: process.uptime(),
		}
	})

	// Handle encoding of bigints returned by Ogmios and encode Buffers as hex strings
	.mapResponse(({response}) => {
		if (typeof response === 'object') {
			return new Response(
				stringify(response, (_, v) =>
					typeof v === 'object' && v.type === 'Buffer' ? Buffer.from(v.data).toString('hex') : v,
				),
				{headers: {'Content-Type': 'application/json'}},
			)
		}
	})
