import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {dbConnectionOptions} from './config'
import * as schema from './schema'

export const sql = postgres(dbConnectionOptions)
export const db = drizzle(sql, {schema})
