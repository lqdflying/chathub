// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

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
        tool_calls: [
          { function: { arguments: '{}', name: 'get_time' }, id: 't1', type: 'function' },
        ],
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

    expect(normalizeMessagesForMoonshot(messages, true)).toEqual([{ content: 'hi', role: 'user' }]);
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

  it('kimi-k3 uses max reasoning without K2 thinking or mutable sampling fields', () => {
    const result = buildMoonshotPayload({
      frequency_penalty: 0.5,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k3',
      n: 2,
      presence_penalty: 0.5,
      reasoning: { effort: 'low' },
      stream: true,
      temperature: 0.2,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      top_p: 0.5,
      tools: sampleTools,
    } as any);

    expect(result.reasoning_effort).toBe('max');
    expect(result.tools).toEqual(sampleTools);
    expect(result).not.toHaveProperty('frequency_penalty');
    expect(result).not.toHaveProperty('n');
    expect(result).not.toHaveProperty('presence_penalty');
    expect(result).not.toHaveProperty('reasoning');
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('thinking');
    expect(result).not.toHaveProperty('top_p');
  });

  it('kimi-k3 preserves existing reasoning_content on assistant tool calls', () => {
    const result = buildMoonshotPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: 'working',
          reasoning_content: 'previous reasoning',
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
      model: 'kimi-k3',
      stream: true,
      tools: sampleTools,
    } as any);

    const assistant = (result.messages as any[]).find((message) => message.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('previous reasoning');
  });

  it('kimi-k3 does not append the deprecated Moonshot web-search tool', () => {
    const result = buildMoonshotPayload({
      enabledSearch: true,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'kimi-k3',
      stream: true,
      tools: sampleTools,
    } as any);

    expect(result.tools).toEqual(sampleTools);
    expect(result.reasoning_effort).toBe('max');
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
          tools: [
            { apiName: 'search', arguments: '{}', id: 't1', identifier: 'x', type: 'default' },
          ],
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
    const chatChunk = {
      choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
      id: 'chatcmpl-moonshot-debug',
    };
    const mockStream = (async function* () {
      yield chatChunk;
    })();
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue(mockStream);
    vi.stubEnv('DEBUG_MOONSHOT_CHAT_COMPLETION', '1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'kimi-k2.5',
        temperature: 0,
      } as any);
      await response.text();

      // delta chunks are merged into one consolidated record at stream end
      const record = logSpy.mock.calls
        .map(([line]) => line)
        .find((line) => typeof line === 'string' && line.includes('chatcmpl-moonshot-debug'));
      expect(record).toBeDefined();
      expect(JSON.parse(record as string)).toMatchObject({
        finishReason: 'stop',
        id: 'chatcmpl-moonshot-debug',
        text: 'Hello',
      });
      const providerDebugCall = logSpy.mock.calls.find(
        ([label]) => label === '[provider-debug:request]',
      );
      expect(providerDebugCall).toBeDefined();
      expect(JSON.parse(providerDebugCall?.[1] as string)).toMatchObject({
        effectiveURL: {
          originHash: expect.stringMatching(/^[\da-f]{8}$/),
          pathDepth: 3,
          pathHash: expect.stringMatching(/^[\da-f]{8}$/),
          present: true,
          queryKeys: [],
          relative: false,
        },
        model: 'kimi-k2.5',
        provider: 'moonshot',
        route: '/chat/completions',
        tools: { count: 0 },
        turnShape: { count: 1, sequence: ['user:text'] },
      });
    } finally {
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe('LobeMoonshotAI Kimi K3 request boundary', () => {
  it('sends the documented K3 payload through the runtime client', async () => {
    const instance = new LobeMoonshotAI({ apiKey: 'test-key' });
    const mockStream = (async function* () {
      yield {
        choices: [{ delta: { content: 'done' }, finish_reason: 'stop', index: 0 }],
        id: 'chatcmpl-kimi-k3',
      };
    })();
    const createSpy = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue(mockStream);

    const response = await instance.chat({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: null,
          reasoning: { content: 'use the clock tool' },
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{}', name: 'get_time' },
              id: 'call_time',
              type: 'function',
            },
          ],
        },
        { content: '{"time":"now"}', role: 'tool', tool_call_id: 'call_time' },
      ],
      model: 'kimi-k3',
      n: 2,
      temperature: 0.2,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools: sampleTools,
    } as any);
    await response.text();

    const requestPayload = createSpy.mock.calls[0][0] as any;
    const assistantMessage = requestPayload.messages.find(
      (message: any) => message.role === 'assistant',
    );

    expect(requestPayload).toMatchObject({
      model: 'kimi-k3',
      reasoning_effort: 'max',
      tools: sampleTools,
    });
    expect(assistantMessage.reasoning_content).toBe('use the clock tool');
    expect(requestPayload).not.toHaveProperty('n');
    expect(requestPayload).not.toHaveProperty('temperature');
    expect(requestPayload).not.toHaveProperty('thinking');
  });

  it('preserves repeated tool-result rounds in the final Moonshot request', async () => {
    const instance = new LobeMoonshotAI({ apiKey: 'test-key' });
    const mockStream = (async function* () {
      yield {
        choices: [{ delta: { content: 'done' }, finish_reason: 'stop', index: 0 }],
        id: 'chatcmpl-repeated-tools',
      };
    })();
    const createSpy = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue(mockStream);
    const repeatedToolCalls = [
      {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:7',
        type: 'function',
      },
      {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:8',
        type: 'function',
      },
    ];

    const response = await instance.chat({
      messages: [
        { content: 'search first', role: 'user' },
        { content: null, role: 'assistant', tool_calls: repeatedToolCalls },
        {
          content: 'first-result-7',
          role: 'tool',
          tool_call_id: repeatedToolCalls[0].id,
        },
        {
          content: 'first-result-8',
          role: 'tool',
          tool_call_id: repeatedToolCalls[1].id,
        },
        { content: 'search again', role: 'user' },
        { content: null, role: 'assistant', tool_calls: repeatedToolCalls },
        {
          content: 'second-result-7',
          role: 'tool',
          tool_call_id: repeatedToolCalls[0].id,
        },
        {
          content: 'second-result-8',
          role: 'tool',
          tool_call_id: repeatedToolCalls[1].id,
        },
      ],
      model: 'kimi-k2.5',
      tools: sampleTools,
    } as any);
    await response.text();

    const requestPayload = createSpy.mock.calls[0][0] as any;

    expect(
      requestPayload.messages.map((message: any) => ({
        role: message.role,
        toolCallIds: message.tool_calls?.map(({ id }: any) => id),
        toolResultId: message.tool_call_id,
      })),
    ).toEqual([
      { role: 'user', toolCallIds: undefined, toolResultId: undefined },
      {
        role: 'assistant',
        toolCallIds: repeatedToolCalls.map(({ id }) => id),
        toolResultId: undefined,
      },
      {
        role: 'tool',
        toolCallIds: undefined,
        toolResultId: repeatedToolCalls[0].id,
      },
      {
        role: 'tool',
        toolCallIds: undefined,
        toolResultId: repeatedToolCalls[1].id,
      },
      { role: 'user', toolCallIds: undefined, toolResultId: undefined },
      {
        role: 'assistant',
        toolCallIds: repeatedToolCalls.map(({ id }) => id),
        toolResultId: undefined,
      },
      {
        role: 'tool',
        toolCallIds: undefined,
        toolResultId: repeatedToolCalls[0].id,
      },
      {
        role: 'tool',
        toolCallIds: undefined,
        toolResultId: repeatedToolCalls[1].id,
      },
    ]);
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
