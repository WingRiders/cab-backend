import {expect, describe, it} from 'bun:test'
import {treaty} from '@elysiajs/eden'
import {app} from '../src'

const api = treaty(app)

describe('Server', () => {
	it('returns a healthcheck response', async () => {
		const {data} = await api.healthcheck.get()

		expect(data).toHaveProperty('healthy', true)
	})
})
