import {Elysia} from 'elysia'
import {config} from './config'
import {getUTxOs} from './ogmios'

export const app = new Elysia()
	.get('/healthcheck', () => ({healthy: true, uptime: process.uptime()}))
	.get('/utxos/:address', ({params: {address}}) => getUTxOs({addresses: [address]}))
	.listen(config.PORT)
