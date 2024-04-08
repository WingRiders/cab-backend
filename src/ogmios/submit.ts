import {createTransactionSubmissionClient} from '@cardano-ogmios/client'
import {getContext, withClient} from './ogmios'

let txSubmissionClient: Awaited<ReturnType<typeof createTransactionSubmissionClient>> | undefined
const getTxSubmissionClient = async () => {
	// If the underlying socket connection has terminated recreate the client
	if (!txSubmissionClient || txSubmissionClient.context.socket.readyState > 1) {
		txSubmissionClient = await createTransactionSubmissionClient(await getContext())
	}
	return txSubmissionClient
}

const txClient = withClient(getTxSubmissionClient)

export const submitTx = (transactionCbor: string) =>
	txClient((t) => t.submitTransaction(transactionCbor))
