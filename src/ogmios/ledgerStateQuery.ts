import {createLedgerStateQueryClient} from '@cardano-ogmios/client'
import type {Address, ProtocolParameters, TransactionOutputReference} from '@cardano-ogmios/schema'
import {getContext, withClient} from './ogmios'

let ledgerStateQueryClient: Awaited<ReturnType<typeof createLedgerStateQueryClient>> | undefined
const getLedgerStateQueryClient = async () => {
	// If the underlying socket connection has terminated recreate the client
	if (!ledgerStateQueryClient || ledgerStateQueryClient.context.socket.readyState > 1) {
		ledgerStateQueryClient = await createLedgerStateQueryClient(await getContext())
	}
	return ledgerStateQueryClient
}

const queryClient = withClient(getLedgerStateQueryClient)

export const getUTxOs = async (
	filter: {addresses: Address[]} | {outputReferences: TransactionOutputReference[]},
) => queryClient((q) => q.utxo(filter))

export const getRewardAccountSummary = async (stakeKeyHash: string) =>
	queryClient((q) => q.rewardAccountSummaries({keys: [stakeKeyHash]}))

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

export const getNetworkTip = () => queryClient((q) => q.networkTip())

export const getLedgerTip = () => queryClient((q) => q.ledgerTip())
