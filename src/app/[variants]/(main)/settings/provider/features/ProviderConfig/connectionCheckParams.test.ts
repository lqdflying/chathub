import { describe, expect, it } from 'vitest';

import {
  CONNECTION_CHECK_MAX_TOKENS,
  buildConnectionCheckParams,
  hasConnectionCheckResult,
} from './connectionCheckParams';

describe('connectionCheckParams', () => {
  it('caps max_tokens for non-OpenAI-compatible providers', () => {
    expect(buildConnectionCheckParams('openai', 'gpt-4o').max_tokens).toBe(
      CONNECTION_CHECK_MAX_TOKENS,
    );
  });

  it('omits token limit fields for OpenAI-compatible connectivity probes', () => {
    const params = buildConnectionCheckParams('openaicompatible', 'gpt-5.5');

    expect(params).not.toHaveProperty('max_tokens');
    expect(params).not.toHaveProperty('max_output_tokens');
  });

  it('disables Kimi thinking for moonshot connectivity probes', () => {
    const params = buildConnectionCheckParams('moonshot', 'kimi-k2.5');

    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.max_tokens).toBe(CONNECTION_CHECK_MAX_TOKENS);
  });

  it('disables Zhipu thinking for connectivity probes', () => {
    const params = buildConnectionCheckParams('zhipu', 'glm-5.2');

    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.max_tokens).toBe(CONNECTION_CHECK_MAX_TOKENS);
  });

  it('disables MiniMax reasoning_split for connectivity probes', () => {
    const params = buildConnectionCheckParams('minimax', 'MiniMax-M2.5');

    expect(params.reasoning_split).toBe(false);
    expect(params.max_tokens).toBe(CONNECTION_CHECK_MAX_TOKENS);
  });

  it('disables Xiaomi MiMo thinking for connectivity probes', () => {
    const params = buildConnectionCheckParams('mimo', 'mimo-v2.5-pro');

    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.max_tokens).toBe(CONNECTION_CHECK_MAX_TOKENS);
  });

  it('accepts reasoning-only connectivity output', () => {
    expect(hasConnectionCheckResult('', { content: 'thinking trace' })).toBe(true);
  });

  it('rejects empty text and reasoning', () => {
    expect(hasConnectionCheckResult('', { content: '' })).toBe(false);
    expect(hasConnectionCheckResult('   ', { content: '  ' })).toBe(false);
  });
});
