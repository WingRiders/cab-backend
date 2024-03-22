import {Elysia} from 'elysia'
import {config} from './config'

export const app = new Elysia()
	.get('/healthcheck', () => ({healthy: true, uptime: process.uptime()}))
	.listen(config.PORT)
