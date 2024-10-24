import {bech32} from 'bech32'

export const bechAddressToHex = (address: string) =>
  Buffer.from(bech32.fromWords(bech32.decode(address, 114).words))
