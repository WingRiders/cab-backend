import {Elysia, mapResponse, t} from 'elysia'
import JSONbig from 'json-bigint'
import {
  addressesByStakeKeyHash,
  filterUsedAddresses,
  getLastBlock,
  transactionByTxHash,
} from './db/db'
import {
  getLedgerTip,
  getNetworkTip,
  getRewardAccountSummary,
  getUTxOs,
  protocolParameters,
} from './ogmios/ledgerStateQuery'
import {submitTx} from './ogmios/submit'

const {stringify} = JSONbig({useNativeBigInt: true})

export const baseApp = new Elysia()
  // Get healthstatus, just reports if the service is up
  .get('/healthstatus', () => ({status: 'ok'}))

  // Get health of the service
  .get('/healthcheck', async ({set}) => {
    // Check sync status
    const [networkSlot, ledgerSlot, lastBlockSlot] = await Promise.all([
      getNetworkTip().then((tip) => (tip === 'origin' ? 0 : tip.slot)),
      getLedgerTip().then((tip) => (tip === 'origin' ? 0 : tip.slot)),
      getLastBlock().then((block) => (block ? block.slot : 0)),
    ])
    const healthyThresholdSlot = 10
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
          typeof v === 'object' && v.type === 'Buffer' ? Buffer.from(v.data).toString('hex') : v,
        ),
        {...set, headers: {'Content-Type': 'application/json'}},
      )
    }
  })

  // Get protocol params - cached for whole epoch
  .get('/protocolParameters', () => protocolParameters())

  // Get ledger tip
  .get('/ledgerTip', () => getLedgerTip())

  // Get UTxOs for given addresses, optionally tied to a specific slot
  .get('/utxos', ({query: {addresses}}) => getUTxOs({addresses}), {
    query: t.Object({addresses: t.Array(t.String())}),
    transform: ({query}) => {
      query.addresses = (query.addresses as unknown as string).split(',')
    },
  })

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
  .post('/submitTx', ({body: {transactionCbor}}) => submitTx(transactionCbor), {
    body: t.Object({transactionCbor: t.String()}),
  })

  .post('/filterUsedAddresses', ({body: {addresses}}) => filterUsedAddresses(addresses), {
    body: t.Object({addresses: t.Array(t.String())}),
  })
