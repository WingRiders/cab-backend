import {Elysia} from 'elysia'

export const app = new Elysia()
	.get('/healthcheck', () => ({healthy: true, uptime: process.uptime()}))
	.listen(process.env.PORT || 3000)
