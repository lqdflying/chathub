import { describe, expect, it, vi } from 'vitest';

import { sanitizeToolCacheDebugMetadata } from '../cacheDiagnostics';
import {
  deriveCompatPromptCacheKey,
  normalizeOpenAICompatCacheUsage,
  openAICompatCachedTokens,
} from './openaicompatCache';
import { debugOpenAICompatCacheRequest, debugOpenAICompatCacheUsage } from './openaicompatDebug';

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

  it('changes the key when any effective Responses reasoning option changes', async () => {
    const payload = {
      input: [{ content: 'Explain cache hits', role: 'user' }],
      model: 'openai/gpt-5-mini',
      reasoning: { effort: 'medium', summary: 'auto' },
    };

    const autoSummaryKey = await deriveCompatPromptCacheKey(payload, payload.model);
    const detailedSummaryKey = await deriveCompatPromptCacheKey(
      { ...payload, reasoning: { ...payload.reasoning, summary: 'detailed' } },
      payload.model,
    );

    expect(detailedSummaryKey).not.toBe(autoSummaryKey);
  });

  it('does not derive prompt_cache_key for unrelated models by default', async () => {
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

  it('derives prompt_cache_key for any model when the allowlist is bypassed', async () => {
    const key = await deriveCompatPromptCacheKey(
      {
        input: [{ content: 'Hello', role: 'user' }],
        model: 'claude-3-5-sonnet',
      },
      'claude-3-5-sonnet',
      { bypassModelAllowlist: true },
    );

    expect(key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
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

  it('correlates request and usage diagnostics without exposing tool call IDs', () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const toolCache = {
      inputItemCount: 4,
      toolCallCount: 2,
      toolCallSetHash: '0123456789abcdef',
      toolResults: [
        {
          serializedLength: 18,
          truncated: false,
          type: 'object' as const,
          valueHash: 'fedcba9876543210',
        },
      ],
    };

    const requestHash = debugOpenAICompatCacheRequest({
      debugToolCache: toolCache,
      payload: {
        messages: [{ content: 'search result', role: 'tool', tool_call_id: 'private-tool-id' }],
        model: 'gpt-5-mini',
      },
      route: '/chat/completions',
    });
    debugOpenAICompatCacheUsage({
      model: 'gpt-5-mini',
      requestHash,
      route: '/chat/completions',
      toolCache,
      usage: {
        cachedTokens: 64,
        inputTokens: 100,
        responseId: 'response-id',
      },
    });

    const requestRecord = JSON.parse(consoleLogSpy.mock.calls[0][1]);
    const usageRecord = JSON.parse(consoleLogSpy.mock.calls[1][1]);
    expect(requestHash).toMatch(/^[\da-f]{16}$/);
    expect(requestRecord.requestHash).toBe(requestHash);
    expect(requestRecord.toolCache).toEqual(toolCache);
    expect(usageRecord.requestHash).toBe(requestHash);
    expect(usageRecord.responseHash).toMatch(/^[\da-f]{16}$/);
    expect(usageRecord.toolCache).toEqual(toolCache);
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('private-tool-id');
    consoleLogSpy.mockRestore();
  });

  it('reconstructs cache metadata from an allowlist before logging', () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const untrustedMetadata = {
      attackerControlled: 'RAW_LOG_MARKER',
      cachePolicy: {
        chatPromptCacheKey: true,
        nestedAttackerControlled: 'NESTED_RAW_LOG_MARKER',
      },
      inputItemCount: 4,
      toolCallCount: 1,
      toolCallSetHash: '0123456789abcdef',
      toolResults: [
        {
          serializedLength: 18,
          truncated: false,
          type: 'object',
          valueHash: 'fedcba9876543210',
          resultAttackerControlled: 'RESULT_RAW_LOG_MARKER',
        },
      ],
    };

    expect(sanitizeToolCacheDebugMetadata(untrustedMetadata)).toEqual({
      cachePolicy: { chatPromptCacheKey: true },
      inputItemCount: 4,
      toolCallCount: 1,
      toolCallSetHash: '0123456789abcdef',
      toolResults: [
        {
          serializedLength: 18,
          truncated: false,
          type: 'object',
          valueHash: 'fedcba9876543210',
        },
      ],
    });

    const requestHash = debugOpenAICompatCacheRequest({
      debugToolCache: untrustedMetadata,
      payload: { model: 'gpt-5-mini', messages: [] },
      route: '/chat/completions',
    });
    debugOpenAICompatCacheUsage({
      model: 'gpt-5-mini',
      requestHash,
      route: '/chat/completions',
      toolCache: untrustedMetadata,
      usage: {},
    });

    const logs = JSON.stringify(consoleLogSpy.mock.calls);
    expect(logs).not.toContain('RAW_LOG_MARKER');
    expect(logs).not.toContain('NESTED_RAW_LOG_MARKER');
    expect(logs).not.toContain('RESULT_RAW_LOG_MARKER');
    expect(logs).toContain('0123456789abcdef');
    consoleLogSpy.mockRestore();
  });

  it('rejects malformed cache metadata without throwing', () => {
    expect(
      sanitizeToolCacheDebugMetadata({ attackerControlled: 'RAW_LOG_MARKER' }),
    ).toBeUndefined();
    expect(() =>
      debugOpenAICompatCacheRequest({
        debugToolCache: {
          attackerControlled: 'RAW_LOG_MARKER',
        },
        payload: { model: 'gpt-5-mini', messages: [] },
        route: '/chat/completions',
      }),
    ).not.toThrow();
  });
});
