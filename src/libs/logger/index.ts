import Pino from 'pino';

import { bootstrapDebug, getPinoLevel } from './bootstrap';

// CHATHUB_DEBUG=1 only adjusts Pino level. CHATHUB_TOOLS_DEBUG (1|verbose)
// emits dedicated prefixed-JSON MCP/tool records; debug() namespaces remain
// explicit DEBUG=... opt-ins.
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
