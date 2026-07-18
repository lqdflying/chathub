import Pino from 'pino';

import { bootstrapDebug, getPinoLevel } from './bootstrap';

// CHATHUB_DEBUG=1 only adjusts Pino level. CHATHUB_TOOLS_DEBUG (1|verbose)
// auto-enables dedicated sanitized MCP/tool debug() namespaces; any
// other namespaces must be set explicitly via the DEBUG=... env var.
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
