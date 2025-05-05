import {bech32} from 'bech32'
import {config} from './config'

const addressBufferLengthLimit = 114

export const bechAddressToHex = (address: string) =>
  Buffer.from(bech32.fromWords(bech32.decode(address, addressBufferLengthLimit).words))

export const paymentCredentialFromAddress = (address: string) =>
  bechAddressToHex(address).subarray(1, 29)

const bechPrefix = `addr${config.NETWORK === 'preprod' ? '_test' : ''}`

export const hexAddressToBech = (address: Buffer) =>
  bech32.encode(bechPrefix, bech32.toWords(address), addressBufferLengthLimit)

// Shelley initial block
export const originPoint = {
  mainnet: {
    id: 'aa83acbf5904c0edfe4d79b3689d3d00fcfc553cf360fd2229b98d464c28e9de',
    slot: 4492800,
    height: 4490511,
  },
  preprod: {
    id: 'c971bfb21d2732457f9febf79d9b02b20b9a3bef12c561a78b818bcb8b35a574',
    slot: 86400,
    height: 46,
  },
}[config.NETWORK]
