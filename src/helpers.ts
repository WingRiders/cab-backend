import type {TransactionOutputReference} from '@cardano-ogmios/schema'

export const parseUtxoId = (utxoId: string): TransactionOutputReference => {
  const [txHash, index] = utxoId.split('#')
  if (!txHash || !index) throw new Error(`Invalid utxoId format: ${utxoId} (expected txHash#index)`)

  if (txHash.length !== 64)
    throw new Error(`Invalid utxo txHash length: ${txHash.length} (expected 64)`)

  const parsedIndex = Number.parseInt(index, 10)
  if (Number.isNaN(parsedIndex) || parsedIndex < 0)
    throw new Error(`Invalid utxo index: ${index} (expected a non-negative integer)`)

  return {transaction: {id: txHash}, index: parsedIndex}
}
