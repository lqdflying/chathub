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
});
