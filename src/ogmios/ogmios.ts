import {type ConnectionConfig, createInteractionContext} from '@cardano-ogmios/client'
import {config} from '../config'
import {logger} from '../logger'

const httpUrlToWsUrl = (httpUrl: string): string =>
  httpUrl.replace('http://', 'ws://').replace('https://', 'wss://')

export const buildOgmiosConnectionConfig = ({
  OGMIOS_HTTP_URL,
  OGMIOS_HOST,
  REMOTE_OGMIOS_PORT,
}: {
  OGMIOS_HTTP_URL: string | undefined
  OGMIOS_HOST: string | undefined
  REMOTE_OGMIOS_PORT: number | undefined
}): ConnectionConfig => {
  if (OGMIOS_HTTP_URL && OGMIOS_HTTP_URL !== '-1') {
    return {
      address: {
        http: OGMIOS_HTTP_URL,
        webSocket: httpUrlToWsUrl(OGMIOS_HTTP_URL),
      },
    }
  }

  return {
    host: OGMIOS_HOST,
    port: REMOTE_OGMIOS_PORT,
  }
}

let context: Awaited<ReturnType<typeof createInteractionContext>> | undefined
export const getContext = async () => {
  // If the context is undefind, or the connection is closing (2) or closed (3) (re)create the context
  if (!context || context.socket.readyState > 1) {
    logger.info('Ogmios - opening new connection')
    try {
      context = await createInteractionContext(
        (err) => logger.error(err),
        () => logger.warn('Ogmios - connection closed'),
        {
          connection: buildOgmiosConnectionConfig({
            OGMIOS_HOST: config.OGMIOS_HOST,
            REMOTE_OGMIOS_PORT: config.OGMIOS_PORT,
            OGMIOS_HTTP_URL: config.OGMIOS_HTTP_URL,
          }),
        },
      )
    } catch (e) {
      // If we are unable to create the Ogmios interaction context let the process fail
      logger.error(e, 'Ogmios - error while opening new connection')
      process.exit(1)
    }
  }

  return context
}

export const withClient =
  <C>(clientPromise: () => Promise<C>) =>
  async <R>(f: (client: C) => Promise<R>): Promise<R> =>
    f(await clientPromise())
