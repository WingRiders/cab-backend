import {Type} from '@sinclair/typebox'
import {Value} from '@sinclair/typebox/value'

const Env = Type.Object({
	PORT: Type.Number({default: 3000}),
	LOG_LEVEL: Type.String({default: 'debug'}),
	OGMIOS_HOST: Type.String({default: 'localhost'}),
	OGMIOS_PORT: Type.Number({default: 1337}),
	DB_HOST: Type.String(),
	DB_PORT: Type.Number({default: 5432}),
	DB_USER: Type.String(),
	DB_PASSWORD: Type.String(),
	DB_NAME: Type.String(),
	DB_SCHEMA: Type.String({default: 'cab_backend'}),
})

const defaultedEnv = Value.Cast(Env, Value.Convert(Env, process.env))

if (!Value.Check(Env, defaultedEnv)) {
	console.error([...Value.Errors(Env, defaultedEnv)])
	throw new Error('Invalid env variables')
}

export const config = defaultedEnv
