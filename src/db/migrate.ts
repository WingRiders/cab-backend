import {drizzle} from 'drizzle-orm/postgres-js'
import {migrate} from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import {logger} from '../logger'
import {dbConnectionOptions, dbSchema} from './config'

export const migrateDb = async () => {
  logger.info('Migrating database')

  const sql = postgres({...dbConnectionOptions, max: 1})
  const db = drizzle(sql)

  await migrate(db, {migrationsFolder: './drizzle', migrationsSchema: dbSchema})

  await sql.end({timeout: 0})
}
