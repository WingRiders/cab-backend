import type {Config} from 'drizzle-kit'
import {config} from './src/config'

export default {
	schema: './src/db/schema.ts',
	out: './drizzle',
	driver: 'pg',
	dbCredentials: {
		host: config.DB_HOST,
		port: config.DB_PORT,
		user: config.DB_USER,
		password: config.DB_PASSWORD,
		database: config.DB_NAME,
	},
} satisfies Config
