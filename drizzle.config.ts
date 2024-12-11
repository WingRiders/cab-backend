import type {Config} from 'drizzle-kit'
import {config} from './src/config'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: `postgres://${config.DB_USER}:${config.DB_PASSWORD}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}?schema=${config.DB_SCHEMA}&sslmode=${config.DB_SSL_MODE}&sslaccept=${config.DB_SSL_ACCEPT}${config.DB_SSL_CERT ? `&sslcert=${config.DB_SSL_CERT}` : ''}`,
  },
} satisfies Config
