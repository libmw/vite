/* eslint no-console: 0 */

import colors from 'picocolors'
import type { AddressInfo, Server } from 'net'
import os from 'os'
import readline from 'readline'
import type { RollupError } from 'rollup'
import type { ResolvedConfig } from '.'
import type { CommonServerOptions } from './http'
import type { Hostname } from './utils'
import { resolveHostname } from './utils'
import { DEFAULT_IPV4_ADDR, DEFAULT_IPV6_ADDR } from './constants'

export type LogType = 'error' | 'warn' | 'info'
export type LogLevel = LogType | 'silent'
export interface Logger {
  info(msg: string, options?: LogOptions): void
  warn(msg: string, options?: LogOptions): void
  warnOnce(msg: string, options?: LogOptions): void
  error(msg: string, options?: LogErrorOptions): void
  clearScreen(type: LogType): void
  hasErrorLogged(error: Error | RollupError): boolean
  hasWarned: boolean
}

export interface LogOptions {
  clear?: boolean
  timestamp?: boolean
}

export interface LogErrorOptions extends LogOptions {
  error?: Error | RollupError | null
}

export const LogLevels: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3
}

let lastType: LogType | undefined
let lastMsg: string | undefined
let sameCount = 0

function clearScreen() {
  const repeatCount = process.stdout.rows - 2
  const blank = repeatCount > 0 ? '\n'.repeat(repeatCount) : ''
  console.log(blank)
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

export interface LoggerOptions {
  prefix?: string
  allowClearScreen?: boolean
  customLogger?: Logger
}

export function createLogger(
  level: LogLevel = 'info',
  options: LoggerOptions = {}
): Logger {
  if (options.customLogger) {
    return options.customLogger
  }

  const loggedErrors = new WeakSet<Error | RollupError>()
  const { prefix = '[vite]', allowClearScreen = true } = options
  const thresh = LogLevels[level]
  const canClearScreen =
    allowClearScreen && process.stdout.isTTY && !process.env.CI
  const clear = canClearScreen ? clearScreen : () => {}

  function output(type: LogType, msg: string, options: LogErrorOptions = {}) {
    if (thresh >= LogLevels[type]) {
      const method = type === 'info' ? 'log' : type
      const format = () => {
        if (options.timestamp) {
          const tag =
            type === 'info'
              ? colors.cyan(colors.bold(prefix))
              : type === 'warn'
              ? colors.yellow(colors.bold(prefix))
              : colors.red(colors.bold(prefix))
          return `${colors.dim(new Date().toLocaleTimeString())} ${tag} ${msg}`
        } else {
          return msg
        }
      }
      if (options.error) {
        loggedErrors.add(options.error)
      }
      if (canClearScreen) {
        if (type === lastType && msg === lastMsg) {
          sameCount++
          clear()
          console[method](format(), colors.yellow(`(x${sameCount + 1})`))
        } else {
          sameCount = 0
          lastMsg = msg
          lastType = type
          if (options.clear) {
            clear()
          }
          console[method](format())
        }
      } else {
        console[method](format())
      }
    }
  }

  const warnedMessages = new Set<string>()

  const logger: Logger = {
    hasWarned: false,
    info(msg, opts) {
      output('info', msg, opts)
    },
    warn(msg, opts) {
      logger.hasWarned = true
      output('warn', msg, opts)
    },
    warnOnce(msg, opts) {
      if (warnedMessages.has(msg)) return
      logger.hasWarned = true
      output('warn', msg, opts)
      warnedMessages.add(msg)
    },
    error(msg, opts) {
      logger.hasWarned = true
      output('error', msg, opts)
    },
    clearScreen(type) {
      if (thresh >= LogLevels[type]) {
        clear()
      }
    },
    hasErrorLogged(error) {
      return loggedErrors.has(error)
    }
  }

  return logger
}

/**
 * @deprecated Use `server.printUrls()` instead
 */
export function printHttpServerUrls(
  server: Server,
  config: ResolvedConfig
): void {
  printCommonServerUrls(server, config.server, config)
}

export function printCommonServerUrls(
  server: Server,
  options: CommonServerOptions,
  config: ResolvedConfig
): void {
  const address = server.address()
  const isAddressInfo = (x: any): x is AddressInfo => x?.address
  if (isAddressInfo(address)) {
    const hostname = resolveHostname(options.host)
    const protocol = options.https ? 'https' : 'http'
    printServerUrls(
      hostname,
      protocol,
      address.port,
      config.base,
      config.logger.info
    )
  }
}

function printServerUrls(
  hostname: Hostname,
  protocol: string,
  port: number,
  base: string,
  info: Logger['info']
): void {
  if (hostname.host === '127.0.0.1') {
    const url = `${protocol}://${hostname.name}:${colors.bold(port)}${base}`
    info(`  > Local: ${colors.cyan(url)}`)
    if (hostname.name !== '127.0.0.1') {
      info(`  > Network: ${colors.dim('use `--host` to expose')}`)
    }
  } else {
    Object.values(os.networkInterfaces())
      .flatMap((nInterface) => nInterface ?? [])
      .filter((detail) => {
        if (!detail || !detail.address) {
          return false
        }

        // Only show ipv6 url when host is ipv6 and host isn't ::
        if (detail.family === 'IPv6') {
          return (
            hostname.host &&
            hostname.host.includes(detail.address) &&
            hostname.host !== '::'
          )
        } else {
          const isIpv4DefaultAddress = detail.address.includes('127.0.0.1')
          if (
            hostname.host === undefined ||
            hostname.host === DEFAULT_IPV4_ADDR ||
            hostname.host === DEFAULT_IPV6_ADDR ||
            hostname.host.includes(detail.address) ||
            // Use '127.0.0.1' for any other host except '::1' as local url
            // here '127.0.0.1' will be replace to hostname.name later
            (isIpv4DefaultAddress && hostname.host !== '::1')
          ) {
            return true
          }
          return false
        }
      })
      .map((detail) => {
        const type =
          detail.address.includes('127.0.0.1') || detail.address.includes('::1')
            ? 'Local:   '
            : 'Network: '
        let host = detail.address.replace('127.0.0.1', hostname.name)
        if (host.includes(':')) {
          host = `[${host}]`
        }
        const url = `${protocol}://${host}:${colors.bold(port)}${base}`
        return `  > ${type} ${colors.cyan(url)}`
      })
      .forEach((msg) => info(msg))
  }
}
