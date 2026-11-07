import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { convertAnthropicUsage } from './anthropic';

describe('convertAnthropicUsage', () => {
  it('should convert message_start usage with cache information', () => {
    const event = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        usage: {
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 10,
          input_tokens: 100,
          output_tokens: 5,
        },
      },
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(event);

    expect(usage).toEqual({
      inputCacheMissTokens: 100,
      inputCachedTokens: 10,
      inputWriteCacheTokens: 20,
      totalInputTokens: 130,
      totalOutputTokens: 5,
    });
  });

  it('should preserve reported zero cache counters', () => {
    const event = {
      type: 'message_start',
      message: {
        id: 'msg_zero_cache',
        usage: {
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          input_tokens: 100,
          output_tokens: 5,
        },
      },
    } as unknown as Anthropic.MessageStreamEvent;

    expect(convertAnthropicUsage(event)).toEqual({
      inputCacheMissTokens: 100,
      inputCachedTokens: 0,
      inputWriteCacheTokens: 0,
      totalInputTokens: 100,
      totalOutputTokens: 5,
    });
  });

  it('should accumulate output tokens on message_delta', () => {
    const previousUsage = {
      inputCacheMissTokens: 100,
      inputCachedTokens: 10,
      inputWriteCacheTokens: 20,
      totalInputTokens: 130,
      totalOutputTokens: 5,
    };

    const deltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: {
        output_tokens: 8,
      },
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent, previousUsage);

    expect(usage).toEqual({
      inputCacheMissTokens: 100,
      inputCachedTokens: 10,
      inputWriteCacheTokens: 20,
      totalInputTokens: 130,
      totalOutputTokens: 13,
      totalTokens: 143,
    });
  });

  it('should take DeepSeek totals and cost from the final message_delta', () => {
    // Live DeepSeek search turn: message_start counts only the prompt.
    const startUsage = {
      inputCacheMissTokens: 300,
      inputCachedTokens: 0,
      inputWriteCacheTokens: 0,
      totalInputTokens: 300,
      totalOutputTokens: 0,
    };

    const deltaEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 384,
        input_tokens: 7996,
        output_tokens: 192,
        server_tool_use: { web_search_requests: 1 },
      },
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent, startUsage, {
      pricing: {
        currency: 'USD',
        units: [
          { name: 'textInput_cacheRead', rate: 0.003625, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      provider: 'deepseek',
    });

    expect(usage).toEqual({
      // Credits round up per unit: 3479 input + 2 cache read + 168 output.
      cost: 0.003649,
      inputCacheMissTokens: 7996,
      inputCachedTokens: 384,
      inputWriteCacheTokens: 0,
      totalInputTokens: 8380,
      totalOutputTokens: 192,
      totalTokens: 8572,
    });
  });

  it('should keep previous usage when delta has no tokens', () => {
    const previousUsage = {
      totalInputTokens: 50,
      totalOutputTokens: 2,
    };

    const deltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: null,
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent, previousUsage);

    expect(usage).toEqual({
      totalInputTokens: 50,
      totalOutputTokens: 2,
      totalTokens: 52,
    });
  });

  it('should return undefined when delta has no usage and no context', () => {
    const deltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: null,
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent);

    expect(usage).toBeUndefined();
  });
});
