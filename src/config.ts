import {type Static, Type, type UnsafeOptions} from '@sinclair/typebox'
import envSchema from 'env-schema'

const StringEnum = <T extends string[]>(
  values: [...T],
  options?: Exclude<UnsafeOptions, 'type' | 'enum'>,
) =>
  Type.Unsafe<T[number]>({
    ...options,
    type: 'string',
    enum: values,
  })

const Env = Type.Object({
  MODE: StringEnum(['aggregator', 'server', 'both'], {default: 'both'}),
  PORT: Type.Number({default: 3000}),
  LOG_LEVEL: StringEnum(['silent', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'], {
    default: 'info',
  }),
  OGMIOS_HOST: Type.String({default: 'localhost'}),
  OGMIOS_PORT: Type.Number({default: 1337}),
  DB_HOST: Type.String({default: 'localhost'}),
  DB_PORT: Type.Number({default: 5432}),
  DB_USER: Type.String(),
  DB_PASSWORD: Type.String(),
  DB_NAME: Type.String(),
  DB_SCHEMA: Type.String({default: 'cab_backend'}),
})

export const config = envSchema<Static<typeof Env>>({schema: Env})
