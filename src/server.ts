import type {Point} from '@cardano-ogmios/schema'
import cors from '@elysiajs/cors'
import type {Serve} from 'bun'
import {Elysia, mapResponse, t} from 'elysia'
import JSONbig from 'json-bigint'
import {
  addressesByStakeKeyHash,
  filterUsedAddresses,
  getLastBlock,
  transactionByTxHash,
  utxosByAddresses,
  utxosByReferences,
  utxosByScriptHashes,
} from './db/db'
import {originPoint} from './helpers.ts'
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

export const app = new Elysia({
  serve: {
    idleTimeout: 60, // Set request timeout to 1 minute
  } as Serve & {idleTimeout: number}, // Bun.serve does not officially expose idleTimeout option
})

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

  /**
   * @deprecated Use POST /utxos instead
   * @description Get UTxOs for given shelley bech32 addresses, references or script hashes
   */
  .get(
    '/utxos',
    async ({query: {addresses, references, scriptHashes}}) => {
      if ([addresses, references, scriptHashes].filter(Boolean).length > 1)
        throw new Error('Only one of addresses, references, or scriptHashes can be provided')

      if (addresses) return utxosByAddresses(addresses)
      if (references) return utxosByReferences(references)
      if (scriptHashes) return utxosByScriptHashes(scriptHashes)

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

  // Get UTxOs for given shelley bech32 addresses, references or script hashes
  .post(
    '/utxos',
    async ({body: {source, pagination, filterOptions, includeTxIndex}}) => {
      const utxoQueryOptions = {
        limit: pagination?.limit,
        lastSeenUtxoId: pagination?.lastSeenUtxoId,
        hasOneOfTokens: filterOptions?.hasOneOfTokens,
        mustHaveDatum: filterOptions?.mustHaveDatum,
        includeTxIndex,
      }
      if ('addresses' in source) return utxosByAddresses(source.addresses, utxoQueryOptions)
      if ('references' in source) return utxosByReferences(source.references, utxoQueryOptions)
      if ('scriptHashes' in source)
        return utxosByScriptHashes(source.scriptHashes, utxoQueryOptions)
    },
    {
      body: t.Object({
        source: t.Union([
          t.Object({addresses: t.Array(t.String(), {minItems: 1})}, {additionalProperties: false}),
          t.Object({references: t.Array(t.String(), {minItems: 1})}, {additionalProperties: false}),
          t.Object(
            {scriptHashes: t.Array(t.String(), {minItems: 1})},
            {additionalProperties: false},
          ),
        ]),
        pagination: t.Optional(
          t.Object({
            limit: t.Number({minimum: 1}),
            lastSeenUtxoId: t.Optional(t.String()),
          }),
        ),
        filterOptions: t.Optional(
          t.Object({
            hasOneOfTokens: t.Optional(
              t.Array(t.Object({policyId: t.String(), assetName: t.String()})),
            ),
            mustHaveDatum: t.Optional(t.Boolean({default: false})),
          }),
        ),
        includeTxIndex: t.Optional(t.Boolean({default: false})),
      }),
    },
  )

  // Get stake key info - rewards, delegated, stake pool id
  .get('/rewardAccountSummary/:stakeKeyHash', async ({params: {stakeKeyHash}, set}) => {
    const rewardAccountSummaries = await getRewardAccountSummary(stakeKeyHash)
    if (!rewardAccountSummaries?.length) {
      set.status = 404
      return {msg: 'Stake key not found, or the stake key is not registered'}
    }
    return rewardAccountSummaries[0]
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
