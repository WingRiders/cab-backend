import pino from 'pino'
import {config} from './config'

export const logger: pino.Logger = pino({
  name: 'cab-backend',
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      }
    : {}),
})
