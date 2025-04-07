import type {Point} from '@cardano-ogmios/schema'
import cors from '@elysiajs/cors'
import {Elysia, mapResponse, t} from 'elysia'
import JSONbig from 'json-bigint'
import {
  addressesByScriptHashes,
  addressesByStakeKeyHash,
  filterUsedAddresses,
  getLastBlock,
  transactionByTxHash,
  utxosByAddresses,
  utxosByReferences,
} from './db/db'
import {hexAddressToBech, originPoint} from './helpers.ts'
import {
  getLedgerTip,
  getNetworkTip,
  getRewardAccountSummary,
  protocolParameters,
} from './ogmios/ledgerStateQuery'
import {submitTx} from './ogmios/submit'

const {stringify} = JSONbig({useNativeBigInt: true})

export const baseApp = new Elysia()
  .use(
    cors({
      origin: '*',
      methods: ['GET', 'POST'],
    }),
  )
  // Get healthstatus, just reports if the service is up
  .get('/healthstatus', () => ({status: 'ok'}))

  // Get health of the service
  .get('/healthcheck', async ({set}) => {
    // Check sync status
    const tipToSlot = (tip: Point | 'origin') => (tip === 'origin' ? originPoint.slot : tip.slot)
    const lastBlockPromise = getLastBlock()
    const networkTipPromise = getNetworkTip()
    const [networkSlot, ledgerSlot, lastBlockSlot, isDbConnected, isOgmiosConnected] =
      await Promise.all([
        networkTipPromise.then(tipToSlot).catch(() => 0),
        getLedgerTip()
          .then(tipToSlot)
          .catch(() => 0),
        lastBlockPromise.then((block) => (block ? block.slot : 0)).catch(() => 0),
        lastBlockPromise.then(() => true).catch(() => false),
        networkTipPromise.then(() => true).catch(() => false),
      ])
    const healthyThresholdSlot = 300 // 5 minutes
    const healthy =
      networkSlot - ledgerSlot < healthyThresholdSlot &&
      ledgerSlot - lastBlockSlot < healthyThresholdSlot

    if (!healthy) {
      set.status = 503
    }

    return {
      healthy,
      networkSlot,
      ledgerSlot,
      lastBlockSlot,
      isDbConnected,
      isOgmiosConnected,
      version: process.env.npm_package_version,
      uptime: process.uptime(),
    }
  })

export const app = new Elysia()
  // Reuse baseApp for /healthstatus
  .use(baseApp)

  // Handle encoding of bigints returned by Ogmios and encode Buffers as hex strings
  .mapResponse(({response, set}) => {
    if (typeof response === 'object') {
      return mapResponse(
        stringify(response, (_, v) =>
          typeof v === 'object' && v !== null && v.type === 'Buffer'
            ? Buffer.from(v.data).toString('hex')
            : v,
        ),
        {...set, headers: {'Content-Type': 'application/json'}},
      )
    }
  })

  // Get protocol params - cached for whole epoch
  .get('/protocolParameters', () => protocolParameters())

  // Get ledger tip
  .get('/ledgerTip', () => getLedgerTip())

  // Get UTxOs for given shelley bech32 addresses or references
  .get(
    '/utxos',
    async ({query: {addresses, references, scriptHashes}}) => {
      if ([addresses, references, scriptHashes].filter(Boolean).length > 1)
        throw new Error('Only one of addresses, references, or scriptHashes can be provided')

      if (addresses) return utxosByAddresses(addresses)
      if (references) return utxosByReferences(references)
      if (scriptHashes) {
        const addresses = await addressesByScriptHashes(scriptHashes)
        return utxosByAddresses(addresses.map(({address}) => hexAddressToBech(address)))
      }

      throw new Error('Either addresses, references, or scriptHashes must be provided')
    },
    {
      query: t.Object({
        addresses: t.Optional(t.Array(t.String())),
        references: t.Optional(t.Array(t.String())),
        scriptHashes: t.Optional(t.Array(t.String())),
      }),
      transform: ({query}) => {
        query.addresses = (query.addresses as unknown as string | undefined)?.split(',')
        query.references = (query.references as unknown as string | undefined)?.split(',')
        query.scriptHashes = (query.scriptHashes as unknown as string | undefined)?.split(',')
      },
    },
  )

  // Get stake key info - rewards, delegated, stake pool id
  .get('/rewardAccountSummary/:stakeKeyHash', async ({params: {stakeKeyHash}, set}) => {
    const rewardAccountSummary = (await getRewardAccountSummary(stakeKeyHash))[stakeKeyHash]
    if (!rewardAccountSummary) {
      set.status = 404
      return {msg: 'Stake key not found, or the stake key is not registered'}
    }
    return rewardAccountSummary
  })

  // Gets list of used addresses for given stakeKeyHash
  .get('/addresses/:stakeKeyHash', async ({params: {stakeKeyHash}}) =>
    addressesByStakeKeyHash(stakeKeyHash),
  )

  // Check if TX is on blockchain
  .get('/transaction/:txHash', async ({params: {txHash}, set}) => {
    const transaction = await transactionByTxHash(txHash)
    if (!transaction) {
      set.status = 404
      return {msg: 'Transaction not found'}
    }
    return transaction
  })

  // Submit a TX - non-blocking - don't wait for TX delivery
  .post(
    '/submitTx',
    ({body: {transactionCbor}, set}) =>
      submitTx(transactionCbor).catch((e) => {
        set.status = e.code && e.code >= 3000 && e.code < 4000 ? 400 : 500
        return {
          message: e.message || 'Unknown error occurred',
          data: e.data,
          code: e.code,
        }
      }),
    {
      body: t.Object({transactionCbor: t.String()}),
    },
  )

  .post('/filterUsedAddresses', ({body: {addresses}}) => filterUsedAddresses(addresses), {
    body: t.Object({addresses: t.Array(t.String())}),
  })
