import fs from 'node:fs'
import postgres from 'postgres'
import {config} from '../config'

export const dbSchema = config.DB_SCHEMA

export const dbConnectionOptions = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  db: config.DB_NAME,
  connection: {
    search_path: dbSchema,
  },
  types: {
    bigint: postgres.BigInt,
  },
  ssl:
    config.DB_SSL_MODE === 'require'
      ? {
          rejectUnauthorized: config.DB_SSL_ACCEPT === 'strict',
          ca: config.DB_SSL_CERT ? fs.readFileSync(config.DB_SSL_CERT).toString() : undefined,
        }
      : undefined,
}
