// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import { LobeMoonshotAI, buildMoonshotPayload, normalizeMessagesForMoonshot } from './index';

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

  it('drops empty assistant messages that only carry internal `tools` without outbound tool_calls', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tools: [{ apiName: 'search', arguments: '{}', id: 't1', identifier: 'x', type: 'default' }],
      },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages, true)).toEqual([{ content: 'hi', role: 'user' }]);
  });
});

const sampleTools = [
  { function: { name: 'get_time', parameters: {}, description: '' }, type: 'function' },
] as any;

describe('buildMoonshotPayload — tool-call safety', () => {
  it('kimi-k2.5 + tools + thinking enabled keeps tools and sends thinking without legacy sampling', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.5',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('top_p');
    expect(result).not.toHaveProperty('frequency_penalty');
    expect(result).not.toHaveProperty('presence_penalty');
  });

  it('kimi-k2.5 connectivity probe with thinking disabled sends disabled thinking', () => {
    const result = buildMoonshotPayload({
      max_tokens: 256,
      messages: [{ content: 'hello', role: 'user' }],
      model: 'kimi-k2.5',
      stream: true,
      thinking: { type: 'disabled' },
    } as any);

    expect(result.thinking).toEqual({ type: 'disabled' });
    expect(result.max_tokens).toBe(256);
  });

  it('kimi-k2.5 + tools + thinking disabled keeps tools and sends disabled thinking without legacy sampling', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2.5',
      stream: true,
      thinking: { budget_tokens: 0, type: 'disabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result.thinking).toEqual({ type: 'disabled' });
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('top_p');
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
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('top_p');
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
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('top_p');
  });

  it('kimi-k2.7-code uses native thinking and preserves reasoning_content on assistant tool calls', () => {
    const result = buildMoonshotPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: null,
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"x":1}', name: 'get_time' },
              id: 'call_time',
              type: 'function',
            },
          ],
        },
        { content: '{"time":"now"}', role: 'tool', tool_call_id: 'call_time' },
      ],
      model: 'kimi-k2.7-code',
      stream: true,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result).not.toHaveProperty('thinking');
    expect(result).not.toHaveProperty('temperature');
    const assistant = (result.messages as any[]).find((m) => m.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('');
  });

  it('kimi-k2-0905-preview + tools strips legacy sampling and omits thinking', () => {
    const result = buildMoonshotPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k2-0905-preview',
      stream: true,
      temperature: 1.4,
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result).not.toHaveProperty('thinking');
    expect(result).not.toHaveProperty('temperature');
  });

  it('drops internal tools-only assistant messages from the provider payload', () => {
    const result = buildMoonshotPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tools: [{ apiName: 'search', arguments: '{}', id: 't1', identifier: 'x', type: 'default' }],
        },
      ],
      model: 'kimi-k2.6',
      stream: true,
      thinking: { type: 'enabled' },
    } as any);

    expect(result.messages).toEqual([{ content: 'hi', role: 'user' }]);
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

describe('LobeMoonshotAI debug', () => {
  it('logs structured request summary with DEBUG_MOONSHOT_CHAT_COMPLETION', async () => {
    const instance = new LobeMoonshotAI({ apiKey: 'test-key' });
    const mockProdStream = new ReadableStream() as any;
    const mockDebugStream = new ReadableStream() as any;
    mockDebugStream.toReadableStream = () => mockDebugStream;

    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue({
      tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
    });
    vi.stubEnv('DEBUG_MOONSHOT_CHAT_COMPLETION', '1');
    const debugStreamSpy = vi
      .spyOn(debugStreamModule, 'debugStream')
      .mockImplementation(() => Promise.resolve());
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'kimi-k2.5',
        temperature: 0,
      } as any);

      expect(debugStreamModule.debugStream).toHaveBeenCalled();
      const providerDebugCall = logSpy.mock.calls.find(
        ([label]) => label === '[provider-debug:request]',
      );
      expect(providerDebugCall).toBeDefined();
      expect(JSON.parse(providerDebugCall?.[1] as string)).toMatchObject({
        effectiveURL: 'https://api.moonshot.cn/v1/chat/completions',
        model: 'kimi-k2.5',
        provider: 'moonshot',
        route: '/chat/completions',
        tools: { count: 0 },
        turnShape: { count: 1, sequence: ['user:text'] },
      });
    } finally {
      debugStreamSpy.mockRestore();
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
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
    expect(result).not.toHaveProperty('temperature');
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
    expect(result).not.toHaveProperty('temperature');
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
    expect(result).not.toHaveProperty('temperature');
  });
});
