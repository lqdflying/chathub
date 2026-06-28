// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

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

  describe('defaultHeaders', () => {
    it('forwards defaultHeaders to the Anthropic SDK client', () => {
      const customHeaders = {
        'User-Agent': 'claude-code/2.1.92',
        'x-app': 'cli',
        'X-Claude-Code-Session-Id': '550e8400-e29b-41d4-a716-446655440000',
      };

      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'test-key',
        defaultHeaders: customHeaders,
      });

      const sdkHeaders = (instance as any).client._options.defaultHeaders;
      expect(sdkHeaders['User-Agent']).toBe('claude-code/2.1.92');
      expect(sdkHeaders['x-app']).toBe('cli');
      expect(sdkHeaders['X-Claude-Code-Session-Id']).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('works with bearer mode and defaultHeaders together', () => {
      const instance = new LobeAnthropicCompatibleAI({
        apiKey: 'my-token',
        authMode: 'bearer',
        defaultHeaders: { 'x-app': 'cli' },
      });

      expect(instance.apiKey).toBeUndefined();
      expect((instance as any).authToken).toBe('my-token');
      expect((instance as any).client._options.defaultHeaders['x-app']).toBe('cli');
    });
  });
});
