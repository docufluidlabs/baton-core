import pino, { Logger } from 'pino';
import env from '../env';
import { requestContext } from './context';

function resolveLogLevel(): string {
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  return env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export const logger = pino({
  level: resolveLogLevel(),
  base: {
    service: 'baton-api',
    env: env.NODE_ENV,
    version: process.env.npm_package_version ?? 'unknown',
    ddsource: 'nodejs',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  mixin: () => requestContext.getStore() ?? {},
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.secret',
      '*.clientSecret',
    ],
    censor: '[REDACTED]',
  },
  transport: env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

/**
 * Create a child logger with bound context fields.
 * Every log line from the child automatically includes the bindings.
 *
 * Usage:
 *   const log = createLogger({ requestId, orgId });
 *   log.info('something happened');
 */
export function createLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

export const logInfo = (message: string, data?: Record<string, any>) => {
  logger.info(data || {}, message);
};

export const logError = (message: string, error?: any, data?: Record<string, any>) => {
  logger.error({ err: error, ...data }, message);
};

export const logWarn = (message: string, data?: Record<string, any>) => {
  logger.warn(data || {}, message);
};

export const logDebug = (message: string, data?: Record<string, any>) => {
  logger.debug(data || {}, message);
};
