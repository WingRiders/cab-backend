// Runs database migrations, separate script, can be started with
// > bun db:migrate

import {drizzle} from 'drizzle-orm/postgres-js'
import {migrate} from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import {dbConnectionOptions, dbSchema} from './config'

const sql = postgres({...dbConnectionOptions, max: 1})
const db = drizzle(sql)

await migrate(db, {migrationsFolder: './drizzle', migrationsSchema: dbSchema})

await sql.end()
