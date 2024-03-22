import {createInteractionContext, createLedgerStateQueryClient} from '@cardano-ogmios/client'
import type {Address, TransactionOutputReference} from '@cardano-ogmios/schema'
import {config} from './config'

let context: Awaited<ReturnType<typeof createInteractionContext>> | undefined
const getContext = async () => {
	// If the context is undefind, or the connection is closing (2) or closed (3) (re)create the context
	if (!context || context.socket.readyState > 1) {
		console.log('Opening new Ogmios connection')
		context = await createInteractionContext(
			(err) => console.error(err),
			() => console.log('Connection closed.'),
			{
				connection: {
					host: config.OGMIOS_HOST,
					port: config.OGMIOS_PORT,
				},
			},
		)
	}
	return context
}

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
	const ogmiosUTxOs = await client.utxo(filter)
	return ogmiosUTxOs.map((utxo) => ({
		txhash: utxo.transaction.id,
		index: utxo.index,
		address: utxo.address,
		value: Object.fromEntries(
			Object.entries(utxo.value).map(([policyId, v]) => [
				policyId,
				Object.fromEntries(
					Object.entries(v).map(([assetId, quantity]) => [assetId, quantity.toString()]),
				),
			]),
		) as {
			ada: {
				lovelace: string
			}
			[k: string]: {
				[k: string]: string
			}
		},
		datum: utxo.datum,
		datumHash: utxo.datumHash,
		script: utxo.script,
	}))
}
