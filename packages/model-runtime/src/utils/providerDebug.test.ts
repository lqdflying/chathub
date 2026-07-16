import { describe, expect, it, vi } from 'vitest';

import {
  buildProviderDebugRequest,
  debugProviderRequest,
  stableHash,
  summarizeProviderDebugURL,
} from './providerDebug';

describe('providerDebug', () => {
  const payload = {
    apiKey: 'must-not-appear',
    messages: [
      { content: 'hello', role: 'user' },
      { content: [{ text: 'answer', type: 'text' }], role: 'assistant' },
    ],
    model: 'test-model',
    stream: true,
    temperature: 0,
    tools: [{ function: { name: 'search' }, type: 'function' }],
  };

  it('builds redacted request-shape summaries', () => {
    const summary = buildProviderDebugRequest({
      baseURL:
        'https://api-user:api-password@api.secretproxy.example:8443/v1?tenant=private-tenant',
      payload,
      provider: 'moonshot',
      route: '/chat/completions',
    });

    expect(summary).toMatchObject({
      baseURL: {
        originHash: stableHash('https://api.secretproxy.example:8443'),
        pathDepth: 1,
        pathHash: stableHash('/v1'),
        present: true,
        queryKeys: ['tenant'],
        relative: false,
      },
      effectiveURL: {
        originHash: stableHash('https://api.secretproxy.example:8443'),
        pathDepth: 3,
        pathHash: stableHash('/v1/chat/completions'),
        present: true,
        queryKeys: ['tenant'],
        relative: false,
      },
      model: 'test-model',
      params: {
        hasTemperature: true,
      },
      provider: 'moonshot',
      route: '/chat/completions',
      stream: true,
      tools: {
        count: 1,
        fingerprint: stableHash(payload.tools),
      },
      turnShape: {
        count: 2,
        sequence: ['user:text', 'assistant:text'],
      },
    });
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain('api-user');
    expect(serializedSummary).not.toContain('api-password');
    expect(serializedSummary).not.toContain('secretproxy');
    expect(serializedSummary).not.toContain('private-tenant');
    expect(serializedSummary).not.toContain('must-not-appear');
    expect(serializedSummary).not.toContain('search');
    expect(summary.payloadFingerprint).toMatch(/^[\da-f]{8}$/);

    const summaryWithDifferentSecret = buildProviderDebugRequest({
      baseURL: 'https://api.secretproxy.example/v1',
      payload: { ...payload, apiKey: 'different-secret' },
      provider: 'moonshot',
      route: '/chat/completions',
    });
    expect(summaryWithDifferentSecret.payloadFingerprint).toBe(summary.payloadFingerprint);
  });

  it('summarizes relative and invalid URLs without exposing their values', () => {
    expect(summarizeProviderDebugURL('/tenant/private/responses?api_key=secret')).toEqual({
      originHash: undefined,
      pathDepth: 3,
      pathHash: stableHash('/tenant/private/responses'),
      present: true,
      queryKeys: ['api_key'],
      relative: true,
    });
    expect(summarizeProviderDebugURL('not a valid URL')).toEqual({
      hash: stableHash('not a valid URL'),
      present: true,
      valid: false,
    });
  });

  it('logs one JSON line with the provider debug label', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      debugProviderRequest({
        baseURL: 'https://api.secretproxy.example/v1',
        payload,
        provider: 'deepseek',
        route: '/chat/completions',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [label, body] = logSpy.mock.calls[0];
      expect(label).toBe('[provider-debug:request]');
      expect(JSON.parse(body as string)).toMatchObject({
        effectiveURL: {
          originHash: stableHash('https://api.secretproxy.example'),
          pathDepth: 3,
          pathHash: stableHash('/v1/chat/completions'),
          present: true,
          queryKeys: [],
          relative: false,
        },
        provider: 'deepseek',
        route: '/chat/completions',
      });
      expect(body).not.toContain('secretproxy');
      expect(body).not.toContain('must-not-appear');
      expect(body).not.toContain('search');
    } finally {
      logSpy.mockRestore();
    }
  });
});
