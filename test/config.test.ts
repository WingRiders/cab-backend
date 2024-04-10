import {describe, expect, it} from 'bun:test'

describe('Config', () => {
  it('returns correct config with default values', async () => {
    // make env the minimal config
    process.env = {
      DB_USER: 'user',
      DB_PASSWORD: 'password',
      DB_NAME: 'db_name',
    }

    // after changing the env load the config
    const {config} = await import('../src/config')

    expect(config).toMatchObject({
      MODE: 'both',
      PORT: 3000,
      LOG_LEVEL: 'info',
      OGMIOS_HOST: 'localhost',
      OGMIOS_PORT: 1337,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'user',
      DB_PASSWORD: 'password',
      DB_NAME: 'db_name',
      DB_SCHEMA: 'cab_backend',
    })
  })
})
