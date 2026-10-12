import {
  type ConnectionConfig,
  type InteractionContext,
  createInteractionContext,
} from '@cardano-ogmios/client'
import {config} from '../config'
import {logger} from '../logger'

export type OgmiosClient = {
  // Called synchronously on every close, it must drop all references to the closed connection
  closeFn: () => void
  initializeFn: (context: InteractionContext) => Promise<void>
}

// The Ogmios provider drops every connection of an instance at once when it replaces the instance.
// A random delay keeps all services from reconnecting in the same moment.
const RECONNECT_JITTER_MAX_MS = 5_000
const RECONNECT_BACKOFF_MIN_MS = 1_000
const RECONNECT_BACKOFF_MAX_MS = 30_000
// How long an API request waits for a reconnect before it fails
const CONNECTION_WAIT_TIMEOUT_MS = 10_000
// Every request in flight holds a 'message' and a 'close' listener on the socket until it gets its
// response. The default limit of 10 warns already at 9 parallel API requests.
const MAX_SOCKET_LISTENERS = 200

// The subdomain of OGMIOS_HTTP_URL is the API key of the provider. Connection errors contain the
// host in the message and in other fields, so they are logged only after the host is replaced.
const secretOgmiosHost =
  config.OGMIOS_HTTP_URL && config.OGMIOS_HTTP_URL !== '-1'
    ? new URL(config.OGMIOS_HTTP_URL).hostname
    : undefined

const redactOgmiosError = (error: unknown) => {
  const fields =
    error instanceof Error
      ? {...error, type: error.name, message: error.message, stack: error.stack}
      : {error: String(error)}
  const json = JSON.stringify(fields, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
  return JSON.parse(secretOgmiosHost ? json.replaceAll(secretOgmiosHost, '<redacted>') : json)
}

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

// Resolved while a connection with all clients initialized is open
let connected = Promise.withResolvers<void>()
let isConnected = false

export const waitForOgmiosConnection = async () => {
  if (isConnected) return
  let timeout: Timer | undefined
  try {
    await Promise.race([
      connected.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Ogmios is not connected')),
          CONNECTION_WAIT_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Opens a connection and initializes all clients on it.
 * Returns a promise that resolves once that connection closes, or throws if the initialization fails.
 */
const connectOgmiosClients = async (clients: OgmiosClient[]): Promise<Promise<void>> => {
  const closed = Promise.withResolvers<void>()
  let isInitialized = false
  let isAbandoned = false

  logger.info('Ogmios - opening new connection')
  const context = await createInteractionContext(
    // A close event always follows an error event, the close path does the reconnect
    (error) => logger.error({err: redactOgmiosError(error)}, 'Ogmios - connection error'),
    (code, reason) => {
      // The clients of an abandoned connection are closed already and may have been replaced
      if (!isAbandoned) {
        for (const {closeFn} of clients) closeFn()
      }
      if (isInitialized) {
        isConnected = false
        connected = Promise.withResolvers()
      }
      logger.warn({code, reason}, 'Ogmios - connection closed')
      closed.resolve()
    },
    {
      connection: buildOgmiosConnectionConfig({
        OGMIOS_HOST: config.OGMIOS_HOST,
        REMOTE_OGMIOS_PORT: config.OGMIOS_PORT,
        OGMIOS_HTTP_URL: config.OGMIOS_HTTP_URL,
      }),
      maxEventListeners: MAX_SOCKET_LISTENERS,
    },
  )

  try {
    for (const {initializeFn} of clients) {
      await initializeFn(context)
    }
    // A request sent on a closed socket does not always reject, so the initialization can succeed
    // after the close handler already dropped the clients
    if (context.socket.readyState !== context.socket.OPEN) {
      throw new Error('Ogmios connection closed during initialization')
    }
  } catch (error) {
    // The clients initialized before the failure hold this connection. Close them now, as the close
    // event of a dead connection can arrive only after the next connection initialized its clients.
    for (const {closeFn} of clients) closeFn()
    isAbandoned = true
    context.socket.terminate()
    throw error
  }

  isInitialized = true
  isConnected = true
  connected.resolve()
  logger.info('Ogmios - connection initialized')
  return closed.promise
}

/**
 * Owns the Ogmios connection: opens it, initializes the clients on it and reconnects after every
 * close. Nothing else opens a connection.
 */
export const ogmiosClientsInitializerLoop = async (clients: OgmiosClient[]): Promise<never> => {
  let failedAttempts = 0
  while (true) {
    try {
      const closed = await connectOgmiosClients(clients)
      failedAttempts = 0
      await closed
      await Bun.sleep(Math.random() * RECONNECT_JITTER_MAX_MS)
    } catch (error) {
      failedAttempts++
      const backoffMs = Math.min(
        RECONNECT_BACKOFF_MIN_MS * 2 ** (failedAttempts - 1),
        RECONNECT_BACKOFF_MAX_MS,
      )
      logger.error(
        {err: redactOgmiosError(error)},
        `Ogmios - failed to initialize, retrying in ${backoffMs} ms`,
      )
      await Bun.sleep(backoffMs)
    }
  }
}
