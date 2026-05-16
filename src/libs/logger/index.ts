import Pino from 'pino';

import { bootstrapDebug, getPinoLevel } from './bootstrap';

// CHATHUB_DEBUG=1 only adjusts Pino level; debug() namespaces are not
// auto-enabled and must be set explicitly via the DEBUG=... env var.
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
