// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import { LobeAnthropicCompatibleAI } from './index';

describe('LobeAnthropicCompatibleAI', () => {
  it('uses Anthropic-compatible base URL normalization', () => {
    const instance = new LobeAnthropicCompatibleAI({
      apiKey: 'test-key',
      baseURL: 'https://anthropic-compatible.example/v1',
    });

    expect(instance.baseURL).toBe('https://anthropic-compatible.example');
  });

  describe('authMode', () => {
    it('defaults to api-key mode — apiKey is preserved, no authToken', () => {
      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'test-key',
      });

      expect(instance.apiKey).toBe('test-key');
      expect((instance as any).authToken).toBeUndefined();
    });

    it('api-key mode explicitly — apiKey is preserved', () => {
      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'test-key',
        authMode: 'api-key',
      });

      expect(instance.apiKey).toBe('test-key');
      expect((instance as any).authToken).toBeUndefined();
    });

    it('bearer mode — apiKey moves to authToken', () => {
      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'my-bearer-token',
        authMode: 'bearer',
      });

      expect(instance.apiKey).toBeUndefined();
      expect((instance as any).authToken).toBe('my-bearer-token');
    });

    it('falls back to ANTHROPICCOMPATIBLE_AUTH_MODE env var', () => {
      vi.stubEnv('ANTHROPICCOMPATIBLE_AUTH_MODE', 'bearer');

      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'env-bearer-token',
      });

      expect(instance.apiKey).toBeUndefined();
      expect((instance as any).authToken).toBe('env-bearer-token');

      vi.unstubAllEnvs();
    });

    it('constructor param takes precedence over env var', () => {
      vi.stubEnv('ANTHROPICCOMPATIBLE_AUTH_MODE', 'bearer');

      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'test-key',
        authMode: 'api-key',
      });

      expect(instance.apiKey).toBe('test-key');
      expect((instance as any).authToken).toBeUndefined();

      vi.unstubAllEnvs();
    });
  });

  describe('debug', () => {
    it('logs structured request summary with DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION', async () => {
      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'secret-compatible-key',
        baseURL: 'https://api.anthropicproxy.example/v1',
      });
      const mockProdStream = new ReadableStream() as any;
      const mockDebugStream = new ReadableStream() as any;
      mockDebugStream.toReadableStream = () => mockDebugStream;

      vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue({
        tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
      });
      vi.stubEnv('DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION', '1');
      const debugStreamSpy = vi
        .spyOn(debugStreamModule, 'debugStream')
        .mockImplementation(() => Promise.resolve());
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-sonnet-4-6',
          temperature: 0,
        });

        expect(debugStreamModule.debugStream).toHaveBeenCalled();
        const providerDebugCall = logSpy.mock.calls.find(
          ([label]) => label === '[provider-debug:request]',
        );
        expect(providerDebugCall).toBeDefined();
        const summary = JSON.parse(providerDebugCall?.[1] as string);
        expect(summary).toMatchObject({
          effectiveURL: {
            originHash: expect.stringMatching(/^[\da-f]{8}$/),
            pathDepth: 2,
            pathHash: expect.stringMatching(/^[\da-f]{8}$/),
            present: true,
            queryKeys: [],
            relative: false,
          },
          model: 'claude-sonnet-4-6',
          provider: 'anthropiccompatible',
          route: '/v1/messages',
          tools: { count: 0 },
          turnShape: { count: 1, sequence: ['user:text'] },
        });
        expect(JSON.stringify(summary)).not.toContain('anthropicproxy');
        expect(JSON.stringify(summary)).not.toContain('secret-compatible-key');
      } finally {
        debugStreamSpy.mockRestore();
        logSpy.mockRestore();
        vi.unstubAllEnvs();
      }
    });
  });
});
