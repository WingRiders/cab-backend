import {createLedgerStateQueryClient} from '@cardano-ogmios/client'
import type {Address, ProtocolParameters, TransactionOutputReference} from '@cardano-ogmios/schema'
import {getContext} from './ogmios'

let ledgerStateQueryClient: Awaited<ReturnType<typeof createLedgerStateQueryClient>> | undefined
const getLedgerStateQueryClient = async () => {
	// If the underlying socket connection has terminated recreate the client
	if (!ledgerStateQueryClient || ledgerStateQueryClient.context.socket.readyState > 1) {
		ledgerStateQueryClient = await createLedgerStateQueryClient(await getContext())
	}
	return ledgerStateQueryClient
}

export const getUTxOs = async (
	filter: {addresses: Address[]} | {outputReferences: TransactionOutputReference[]},
) => {
	const client = await getLedgerStateQueryClient()
	return client.utxo(filter)
}

export const rewardAccountSummary = async (stakeKeyHash: string) => {
	const client = await getLedgerStateQueryClient()
	return client.rewardAccountSummaries({keys: [stakeKeyHash]})
}

let cachedProtocolParams: {epoch: number; protocolParams: ProtocolParameters} | undefined
export const protocolParameters = async () => {
	const client = await getLedgerStateQueryClient()
	const currentEpoch = await client.epoch()

	if (!cachedProtocolParams || currentEpoch > cachedProtocolParams.epoch) {
		// only fetch the protocol parameters once per epoch
		cachedProtocolParams = {
			epoch: currentEpoch,
			protocolParams: await client.protocolParameters(),
		}
	}

	return cachedProtocolParams.protocolParams
}

export const getNetworkTip = async () => {
	const client = await getLedgerStateQueryClient()
	return client.networkTip()
}

export const getLedgerTip = async () => {
	const client = await getLedgerStateQueryClient()
	return client.networkTip()
}
