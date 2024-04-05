import {desc, sql as dsql, eq} from 'drizzle-orm'
import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {dbConnectionOptions} from './config'
import * as schema from './schema'

// Open a connection
export const sql = postgres(dbConnectionOptions)
export const db = drizzle(sql, {schema})

// Queries
export const getLastBlock = () => db.query.blocks.findFirst({orderBy: [desc(schema.blocks.slot)]})

export const transactionByTxHash = (txHash: string) =>
	db.query.transactions.findFirst({
		where: eq(schema.transactions.txHash, Buffer.from(txHash, 'hex')),
	})

export const addressesByStakeKeyHash = (stakeKeyHash: string) =>
	db.query.addresses.findMany({
		where: dsql`substr(${schema.addresses},30,28)=${Buffer.from(stakeKeyHash, 'hex')}`,
	})
