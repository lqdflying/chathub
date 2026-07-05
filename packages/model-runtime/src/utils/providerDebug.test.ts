import { describe, expect, it, vi } from 'vitest';

import { buildProviderDebugRequest, debugProviderRequest } from './providerDebug';

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
      baseURL: 'https://api.secretproxy.example/v1',
      payload,
      provider: 'moonshot',
      route: '/chat/completions',
    });

    expect(summary).toMatchObject({
      model: 'test-model',
      params: {
        hasTemperature: true,
      },
      provider: 'moonshot',
      route: '/chat/completions',
      stream: true,
      tools: {
        count: 1,
        names: ['search'],
      },
      turnShape: {
        count: 2,
        sequence: ['user:text', 'assistant:text'],
      },
    });
    expect(summary.baseURL).not.toContain('secretproxy');
    expect(JSON.stringify(summary)).not.toContain('must-not-appear');
    expect(summary.payloadFingerprint).toMatch(/^[\da-f]{8}$/);

    const summaryWithDifferentSecret = buildProviderDebugRequest({
      baseURL: 'https://api.secretproxy.example/v1',
      payload: { ...payload, apiKey: 'different-secret' },
      provider: 'moonshot',
      route: '/chat/completions',
    });
    expect(summaryWithDifferentSecret.payloadFingerprint).toBe(summary.payloadFingerprint);
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
        provider: 'deepseek',
        route: '/chat/completions',
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});
