import pino from 'pino'
import {config} from './config'

export const logger = pino({
  name: 'cab-backend',
  level: config.LOG_LEVEL,
})
