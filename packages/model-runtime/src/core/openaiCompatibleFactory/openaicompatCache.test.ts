import { describe, expect, it } from 'vitest';

import {
  deriveCompatPromptCacheKey,
  normalizeOpenAICompatCacheUsage,
  openAICompatCachedTokens,
} from './openaicompatCache';

describe('openaicompatCache', () => {
  it('derives stable prompt_cache_key for GPT and Codex compatible models', async () => {
    const payload = {
      input: [
        { content: 'You are concise.', role: 'system' },
        { content: 'Explain cache hits', role: 'user' },
        { content: 'Previous assistant turn should not affect the key', role: 'assistant' },
      ],
      model: 'openai/gpt-5-mini',
      reasoning: { effort: 'medium' },
      tools: [{ name: 'search', type: 'function' }],
    };

    const firstKey = await deriveCompatPromptCacheKey(payload, payload.model);
    const secondKey = await deriveCompatPromptCacheKey(
      {
        ...payload,
        input: [...payload.input, { content: 'A later user turn', role: 'user' }],
      },
      payload.model,
    );

    expect(firstKey).toMatch(/^compat_cc_[a-f0-9]{32}$/);
    expect(secondKey).toBe(firstKey);
  });

  it('does not derive prompt_cache_key for unrelated models', async () => {
    await expect(
      deriveCompatPromptCacheKey(
        {
          input: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-5-sonnet',
        },
        'claude-3-5-sonnet',
      ),
    ).resolves.toBe('');
  });

  it('normalizes common OpenAI-compatible cache usage fields for Responses usage', () => {
    const response = {
      id: 'resp_test',
      object: 'response',
      status: 'completed',
      usage: {
        cached_tokens: 88,
        input_tokens: 120,
        output_tokens: 20,
        total_tokens: 140,
      },
    };

    const normalized = normalizeOpenAICompatCacheUsage(response);

    expect(normalized.cachedTokens).toBe(88);
    expect(normalized.changed).toBe(true);
    expect(normalized.json.usage.input_tokens_details.cached_tokens).toBe(88);
  });

  it('extracts fallback cache tokens from sub2api response variants', () => {
    expect(openAICompatCachedTokens({ usage: { prompt_cache_hit_tokens: '42' } })).toBe(42);
    expect(openAICompatCachedTokens({ choices: [{ usage: { cached_tokens: 17 } }] })).toBe(17);
    expect(openAICompatCachedTokens({ timings: { cache_n: 9 } })).toBe(9);
  });
});
