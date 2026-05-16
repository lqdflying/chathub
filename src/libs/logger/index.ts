import Pino from 'pino';

import { bootstrapDebug, getPinoLevel } from './bootstrap';

// Idempotent: safe to call before any const log = debug('...') is evaluated
bootstrapDebug();

export const pino = Pino({
  level: getPinoLevel(),
  redact: {
    censor: '[REDACTED]',
    paths: [
      'apiKey',
      'authorization',
      'Authorization',
      'accessToken',
      'refreshToken',
      'password',
      'secret',
      'token',
      'cookie',
      'x-api-key',
      'api_key',
    ],
  },
});
