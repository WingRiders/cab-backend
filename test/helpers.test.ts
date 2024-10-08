import {describe, expect, it, mock} from 'bun:test'
import {parseUtxoId} from '../src/helpers'

describe('Helpers', () => {
  it('parses utxo id', async () => {
    expect(() =>
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68'),
    ).toThrow('Invalid utxoId format')

    expect(() => parseUtxoId('#')).toThrow('Invalid utxoId format')

    expect(() =>
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68#'),
    ).toThrow('Invalid utxoId format')

    expect(() => parseUtxoId('#0')).toThrow('Invalid utxoId format')

    expect(() =>
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab#0'),
    ).toThrow('Invalid utxo txHash length')

    expect(() =>
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68#a'),
    ).toThrow('Invalid utxo index')

    expect(() =>
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68#-10'),
    ).toThrow('Invalid utxo index')

    expect(
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68#0'),
    ).toEqual({
      transaction: {
        id: '2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68',
      },
      index: 0,
    })

    expect(
      parseUtxoId('2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68#1'),
    ).toEqual({
      transaction: {
        id: '2b40b19a068d198cad48c14621b089b4ff52ed77d3bd6151a79350b72dd9ab68',
      },
      index: 1,
    })
  })
})
