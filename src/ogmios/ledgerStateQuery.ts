import {type LedgerStateQuery, createLedgerStateQueryClient} from '@cardano-ogmios/client'
import type {Address, ProtocolParameters, TransactionOutputReference} from '@cardano-ogmios/schema'
import {type OgmiosClient, waitForOgmiosConnection} from './ogmios'

let ledgerStateQueryClient: LedgerStateQuery.LedgerStateQueryClient | null = null

export const ledgerStateQueryOgmiosClient: OgmiosClient = {
  closeFn: () => {
    ledgerStateQueryClient = null
  },
  initializeFn: async (context) => {
    ledgerStateQueryClient = await createLedgerStateQueryClient(context)
  },
}

const getLedgerStateQueryClient = async ({waitForConnection = true} = {}) => {
  if (waitForConnection) await waitForOgmiosConnection()
  if (!ledgerStateQueryClient) {
    throw new Error('Ogmios ledger state query client is not initialized')
  }
  return ledgerStateQueryClient
}

export const getUTxOs = async (
  filter: {addresses: Address[]} | {outputReferences: TransactionOutputReference[]},
) => (await getLedgerStateQueryClient()).utxo(filter)

export const getRewardAccountSummary = async (stakeKeyHash: string) =>
  (await getLedgerStateQueryClient()).rewardAccountSummaries({keys: [stakeKeyHash]})

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

export const getNetworkTip = async (options?: {waitForConnection?: boolean}) =>
  (await getLedgerStateQueryClient(options)).networkTip()

export const getLedgerTip = async (options?: {waitForConnection?: boolean}) =>
  (await getLedgerStateQueryClient(options)).ledgerTip()
