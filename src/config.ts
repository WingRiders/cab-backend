import {type Static, Type, type UnsafeOptions} from '@sinclair/typebox'
import envSchema from 'env-schema'
import pino from 'pino'

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
  NETWORK: StringEnum(['preprod', 'mainnet'], {default: 'preprod'}),
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
  FIXUP_MISSING_BLOCKS: Type.Optional(Type.String()), // Comma-separated numbers
  FIXUP_CONTINUE_FROM_HEIGHT: Type.Optional(Type.Number()),
})

const unwrapEnv = (): Omit<Static<typeof Env>, 'FIXUP_MISSING_BLOCKS'> & {
  FIXUP_MISSING_BLOCKS: Set<number>
} => {
  try {
    const rawEnv = envSchema<Static<typeof Env>>({schema: Env})
    return {
      ...rawEnv,
      FIXUP_MISSING_BLOCKS: new Set(
        rawEnv.FIXUP_MISSING_BLOCKS?.split(',')
          .map(Number)
          .filter((height) => height > 0) ?? [],
      ),
    }
  } catch (error) {
    // cannot reuse logger here as it requires config to initialize
    pino({name: 'cab-backend'}).error(error)
    process.exit(1)
  }
}

export const config = unwrapEnv()
