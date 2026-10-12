import {type TransactionSubmission, createTransactionSubmissionClient} from '@cardano-ogmios/client'
import {type OgmiosClient, waitForOgmiosConnection} from './ogmios'

let txSubmissionClient: TransactionSubmission.TransactionSubmissionClient | null = null

export const txSubmissionOgmiosClient: OgmiosClient = {
  closeFn: () => {
    txSubmissionClient = null
  },
  initializeFn: async (context) => {
    txSubmissionClient = await createTransactionSubmissionClient(context)
  },
}

// A submit that fails with "Connection closed" (code -32000) is ambiguous, the node may have the tx.
// Submitting the same signed tx again after the reconnect is safe, the node rejects a known tx.
export const submitTx = async (transactionCbor: string) => {
  await waitForOgmiosConnection()
  if (!txSubmissionClient) {
    throw new Error('Ogmios tx submission client is not initialized')
  }
  return txSubmissionClient.submitTransaction(transactionCbor)
}
