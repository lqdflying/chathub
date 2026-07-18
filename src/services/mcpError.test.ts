import { describe, expect, it } from 'vitest';

import { MCPInvocationError, createMCPChatMessageError } from './mcpError';

describe('createMCPChatMessageError', () => {
  it('maps a safe gateway failure without raw HTML or parser text', () => {
    const error = new MCPInvocationError({
      bodyBytes: 615,
      bodyKind: 'html',
      category: 'gateway',
      diagnosticId: 'td_1234567890abcdef',
      durationMs: 6788,
      errorKind: 'response_parse_failed',
      failurePhase: 'response_parse',
      htmlMarker: 'doctype',
      httpStatus: 502,
      mediaType: 'text/html',
      reason: 'response_parse_failed',
      responseFingerprint: 'abcdef0123456789',
    });

    const result = createMCPChatMessageError(error, (type) => `translated:${type}`);

    expect(result).toEqual({
      body: error.details,
      message: 'translated:PluginGatewayError',
      type: 'PluginGatewayError',
    });
    expect(JSON.stringify(result)).not.toContain('<!DOCTYPE');
    expect(JSON.stringify(result)).not.toContain('Unexpected token');
  });

  it('maps unknown failures to a typed server error instead of response.undefined', () => {
    expect(createMCPChatMessageError(new Error('private failure'), (type) => type)).toEqual({
      body: { errorKind: 'unknown_error' },
      message: 'PluginServerError',
      type: 'PluginServerError',
    });
  });
});
