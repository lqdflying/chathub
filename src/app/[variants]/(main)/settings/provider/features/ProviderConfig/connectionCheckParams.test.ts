import { describe, expect, it } from 'vitest';

import {
  CONNECTION_CHECK_MAX_TOKENS,
  buildConnectionCheckParams,
  hasConnectionCheckResult,
  hasSuccessfulConnectionCheck,
} from './connectionCheckParams';

describe('connectionCheckParams', () => {
  it('caps max_tokens for non-OpenAI-compatible providers', () => {
    expect(buildConnectionCheckParams('openai', 'gpt-4o').max_tokens).toBe(
      CONNECTION_CHECK_MAX_TOKENS,
    );
  });

  it('disables streaming for connectivity probes', () => {
    expect(buildConnectionCheckParams('openai', 'gpt-4o').stream).toBe(false);
    expect(buildConnectionCheckParams('minimax', 'MiniMax-M3').stream).toBe(false);
  });

  it('requests JSON so Safari does not parse a short synthetic SSE', () => {
    expect(buildConnectionCheckParams('openai', 'gpt-4o').responseMode).toBe('json');
    expect(buildConnectionCheckParams('minimax', 'MiniMax-M3').responseMode).toBe('json');
    expect(buildConnectionCheckParams('openaicompatible', 'gpt-5.5').responseMode).toBe('json');
  });

  it('omits token limit fields for OpenAI-compatible connectivity probes', () => {
    const params = buildConnectionCheckParams('openaicompatible', 'gpt-5.5');

    expect(params).not.toHaveProperty('max_tokens');
    expect(params).not.toHaveProperty('max_output_tokens');
    expect(params.stream).toBe(false);
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

  it.each(['glm-5.3', 'glm-5.3-flash'])(
    'uses low reasoning_effort and omits thinking.disabled for %s probes',
    (model) => {
      const params = buildConnectionCheckParams('zhipu', model);

      expect(params.thinking).toBeUndefined();
      expect(params.reasoning_effort).toBe('low');
      expect(params.max_tokens).toBe(CONNECTION_CHECK_MAX_TOKENS);
    },
  );

  it('disables MiniMax thinking for connectivity probes and leaves reasoning_split unset', () => {
    const params = buildConnectionCheckParams('minimax', 'MiniMax-M3');

    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params).not.toHaveProperty('reasoning_split');
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

  it('accepts a completed MiniMax JSON envelope even when exposed text is empty', () => {
    expect(hasSuccessfulConnectionCheck('minimax', '', { content: '' }, true)).toBe(true);
    expect(hasSuccessfulConnectionCheck('minimax', '', { content: '' }, false)).toBe(false);
  });

  it('does not relax empty-result checks for other providers', () => {
    expect(hasSuccessfulConnectionCheck('openai', '', { content: '' }, true)).toBe(false);
  });
});
