// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { LobeAnthropicCompatibleAI } from './index';

describe('LobeAnthropicCompatibleAI', () => {
  it('uses Anthropic-compatible base URL normalization', () => {
    const instance = new LobeAnthropicCompatibleAI({
      apiKey: 'test-key',
      baseURL: 'https://anthropic-compatible.example/v1',
    });

    expect(instance.baseURL).toBe('https://anthropic-compatible.example');
  });
});
