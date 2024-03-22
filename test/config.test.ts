import {expect, describe, it} from 'bun:test'
import {config} from '../src/config'

describe('Config', () => {
	it('returns correct config with default values', async () => {
		expect(config).toEqual({PORT: 3000, OGMIOS_HOST: 'localhost', OGMIOS_PORT: 1337})
	})
})
