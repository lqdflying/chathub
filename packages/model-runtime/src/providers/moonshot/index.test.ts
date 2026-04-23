// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildMoonshotPayload, normalizeMessagesForMoonshot } from './index';

describe('normalizeMessagesForMoonshot', () => {
  it('keeps user / system / tool messages untouched', () => {
    const messages = [
      { content: 'hello', role: 'system' },
      { content: 'hi', role: 'user' },
      { content: 'tool result', role: 'tool', tool_call_id: 'abc' },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages)).toEqual(messages);
  });

  it('drops assistant messages with empty string content and no tool_calls', () => {
    // Reproduces the Moonshot error: "the message at position N with role
    // 'assistant' must not be empty". This happens when a prior stream
    // aborted or returned nothing and the empty bubble got persisted.
    const messages = [
      { content: 'hi', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '   ', role: 'assistant' },
      { content: 'are you there?', role: 'user' },
    ] as any;

    const result = normalizeMessagesForMoonshot(messages);

    expect(result).toEqual([
      { content: 'hi', role: 'user' },
      { content: 'are you there?', role: 'user' },
    ]);
  });

  it('drops assistant messages with empty array content and no tool_calls', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      { content: [], role: 'assistant' },
      { content: [{ text: '   ', type: 'text' }], role: 'assistant' },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages)).toEqual([{ content: 'hi', role: 'user' }]);
  });

  it('keeps assistant messages that carry tool_calls even when content is empty', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tool_calls: [{ function: { arguments: '{}', name: 'get_time' }, id: 't1', type: 'function' }],
      },
    ] as any;

    const result = normalizeMessagesForMoonshot(messages);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ role: 'assistant', tool_calls: expect.any(Array) });
  });

  it('maps reasoning onto reasoning_content for non-empty assistant messages', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      {
        content: 'answer',
        reasoning: { content: 'because...', duration: 10 },
        role: 'assistant',
      },
    ] as any;

    const [, assistant] = normalizeMessagesForMoonshot(messages);

    expect(assistant).toEqual({
      content: 'answer',
      reasoning_content: 'because...',
      role: 'assistant',
    });
  });

  it('forces reasoning_content to empty string when forceReasoning is true and reasoning is missing', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      { content: 'answer', role: 'assistant' },
    ] as any;

    const [, assistant] = normalizeMessagesForMoonshot(messages, true);

    expect(assistant).toEqual({
      content: 'answer',
      reasoning_content: '',
      role: 'assistant',
    });
  });

  it('still drops empty assistant messages when forceReasoning is true', () => {
    // kimi-k2.5 / kimi-k2-thinking force reasoning_content. We should not
    // resurrect an empty turn just to attach a blank reasoning field.
    const messages = [
      { content: 'hi', role: 'user' },
      { content: '', role: 'assistant' },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages, true)).toEqual([
      { content: 'hi', role: 'user' },
    ]);
  });

  it('keeps assistant messages that only carry internal `tools` (no tool_calls yet)', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tools: [{ apiName: 'search', arguments: '{}', id: 't1', identifier: 'x', type: 'default' }],
      },
    ] as any;

    const result = normalizeMessagesForMoonshot(messages, true);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      reasoning_content: '',
      role: 'assistant',
      tools: expect.any(Array),
    });
  });
});

const sampleTools = [
  { function: { name: 'get_time', parameters: {}, description: '' }, type: 'function' },
] as any;

describe('buildMoonshotPayload — tool-call safety', () => {
  it('kimi-k2.5 + tools + thinking enabled keeps tools and sends thinking + K2.5 sampling', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.5',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result).toMatchObject({
      thinking: { type: 'enabled' },
      temperature: 1,
      top_p: 0.95,
    });
  });

  it('kimi-k2.5 + tools + thinking disabled keeps tools and sends disabled thinking + non-thinking sampling', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.5',
      stream: true,
      thinking: { budget_tokens: 0, type: 'disabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result).toMatchObject({
      thinking: { type: 'disabled' },
      temperature: 0.6,
      top_p: 0.95,
    });
  });

  it('kimi-k2.6 + tools + thinking enabled matches K2.5-style payload (no keep unless set)', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result).toMatchObject({ temperature: 1, top_p: 0.95 });
  });

  it('kimi-k2.6 + thinking enabled + keep all sends Preserved Thinking', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { budget_tokens: 1024, keep: 'all', type: 'enabled' },
      tools: sampleTools,
    } as any);

    expect(result.thinking).toEqual({ keep: 'all', type: 'enabled' });
  });

  it('kimi-k2-thinking-turbo + tools omits thinking field (native thinking)', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2-thinking-turbo',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result).not.toHaveProperty('thinking');
    expect(result).toMatchObject({
      temperature: 1,
      top_p: 0.95,
    });
  });

  it('kimi-k2-0905-preview + tools halves temperature and omits thinking', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2-0905-preview',
      stream: true,
      temperature: 1.4,
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result).not.toHaveProperty('thinking');
    expect(result.temperature).toBe(0.7);
  });

  it('kimi-k2.6 + thinking injects reasoning_content on assistant tool_calls missing it', () => {
    const result = buildMoonshotPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: null,
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"x":1}', name: '$web_search' },
              id: 'call_ws',
              type: 'function',
            },
          ],
        },
        { content: '{"search_result":{}}', role: 'tool', tool_call_id: 'call_ws' },
      ],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { type: 'enabled' },
      tools: sampleTools,
    } as any);

    const assistant = (result.messages as any[]).find((m) => m.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('');
  });
});

describe('buildMoonshotPayload — enabledSearch forces thinking off', () => {
  it('kimi-k2.6 + enabledSearch + thinking enabled → thinking disabled', () => {
    const result = buildMoonshotPayload({
      enabledSearch: true,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    expect(result.thinking).toEqual({ type: 'disabled' });
    expect(result.temperature).toBe(0.6);
    expect(result.tools).toEqual([{ function: { name: '$web_search' }, type: 'builtin_function' }]);
  });

  it('kimi-k2.5 + enabledSearch + thinking enabled → thinking disabled', () => {
    const result = buildMoonshotPayload({
      enabledSearch: true,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.5',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    expect(result.thinking).toEqual({ type: 'disabled' });
    expect(result.temperature).toBe(0.6);
  });

  it('kimi-k2.6 + enabledSearch does not force reasoning_content on assistant tool_calls', () => {
    const result = buildMoonshotPayload({
      enabledSearch: true,
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: null,
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: '$web_search' },
              id: 'call_ws',
              type: 'function',
            },
          ],
        },
        { content: '{"search_result":{}}', role: 'tool', tool_call_id: 'call_ws' },
      ],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { type: 'enabled' },
    } as any);

    expect(result.thinking).toEqual({ type: 'disabled' });
    const assistant = (result.messages as any[]).find((m) => m.role === 'assistant');
    expect(assistant).not.toHaveProperty('reasoning_content');
  });

  it('kimi-k2.6 + enabledSearch=false + thinking enabled keeps thinking on', () => {
    const result = buildMoonshotPayload({
      enabledSearch: false,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result.temperature).toBe(1);
  });
});
