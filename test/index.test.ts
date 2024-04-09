import {expect, describe, it, mock} from 'bun:test'
import {treaty} from '@elysiajs/eden'
import {app} from '../src/server'

const api = treaty(app.listen(3000))

describe('Server', () => {
	it('returns a healthcheck response', async () => {
		mock.module('../src/db/db', () => ({
			getLastBlock: async () => ({slot: 0}),
		}))
		mock.module('../src/ogmios/ledgerStateQuery', () => ({
			getNetworkTip: async () => ({slot: 10}),
			getLedgerTip: async () => ({slot: 9}),
		}))

		const {data} = await api.healthcheck.get()

		expect(data).toHaveProperty('healthy', true)
	})
})
