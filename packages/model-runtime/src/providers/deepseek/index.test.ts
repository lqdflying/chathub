// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeDeepSeekAI, buildDeepSeekPayload, toDeepSeekAnthropicBaseURL } from './index';

describe('buildDeepSeekPayload', () => {
  const basePayload = {
    messages: [{ content: 'Hello', role: 'user' }],
    model: 'deepseek-v4-pro',
  } as any;

  it('should pass through all standard params when thinking is disabled', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      temperature: 0.8,
      thinking: { type: 'disabled' as const },
      top_p: 0.9,
    });

    expect(payload.model).toBe('deepseek-v4-pro');
    expect(payload.temperature).toBe(0.8);
    expect(payload.top_p).toBe(0.9);
    expect(payload.frequency_penalty).toBe(0.5);
    expect(payload.presence_penalty).toBe(0.3);
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.stream).toBe(true);
  });

  it('should strip sampling params when thinking is enabled', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      temperature: 0.8,
      thinking: { type: 'enabled' as const },
      top_p: 0.9,
    });

    expect(payload.model).toBe('deepseek-v4-pro');
    expect(payload.temperature).toBeUndefined();
    expect(payload.top_p).toBeUndefined();
    expect(payload.frequency_penalty).toBeUndefined();
    expect(payload.presence_penalty).toBeUndefined();
    expect(payload.thinking).toEqual({ type: 'enabled' });
    expect(payload.stream).toBe(true);
  });

  it('should forward reasoning_effort when provided', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      reasoning_effort: 'max',
      thinking: { type: 'enabled' as const },
    });

    expect(payload.reasoning_effort).toBe('max');
    expect(payload.thinking).toEqual({ type: 'enabled' });
  });

  it('should forward tools when provided', () => {
    const tools = [
      {
        function: { description: 'Test tool', name: 'test' },
        type: 'function' as const,
      },
    ];

    const payload = buildDeepSeekPayload({
      ...basePayload,
      tools,
    });

    expect(payload.tools).toEqual(tools);
  });

  it('maps simple-completion thinking-off to type disabled without reasoning_effort', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      max_tokens: 2448,
      thinking: { budget_tokens: 0, type: 'disabled' },
    });

    expect(payload.max_tokens).toBe(2448);
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload).not.toHaveProperty('reasoning_effort');
  });

  it('should preserve the sanitized cached prefix when tool results extend a turn', () => {
    const baseMessages = [
      { content: 'Cached question', role: 'user' },
      {
        content: [
          { signature: 'signature', thinking: 'Stable reasoning', type: 'thinking' },
          { text: 'Cached answer', type: 'text' },
        ],
        role: 'assistant',
      },
      { content: 'Search now', role: 'user' },
    ];
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const continuationMessages = [
      ...baseMessages,
      { content: '', role: 'assistant', tool_calls: [toolCall] },
      { content: 'Search result', role: 'tool', tool_call_id: toolCall.id },
    ];

    const prefix = buildDeepSeekPayload({
      ...basePayload,
      messages: baseMessages,
      thinking: { type: 'enabled' as const },
    });
    const continuation = buildDeepSeekPayload({
      ...basePayload,
      messages: continuationMessages,
      thinking: { type: 'enabled' as const },
    });

    expect((continuation.messages as any[]).slice(0, prefix.messages.length)).toEqual(
      prefix.messages,
    );
    expect((prefix.messages as any[])[1].content).toBe('Cached answer');
  });

  it('should NOT forward reasoning_effort when thinking is disabled', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      reasoning_effort: 'max',
      thinking: { type: 'disabled' as const },
    });

    expect(payload.reasoning_effort).toBeUndefined();
  });

  it('keeps user image_url parts on deepseek-flash', () => {
    const messages = [
      {
        content: [
          { text: 'What is in this image?', type: 'text' },
          {
            image_url: { url: 'https://example.com/chart.png' },
            type: 'image_url',
          },
        ],
        role: 'user',
      },
    ];
    const payload = buildDeepSeekPayload({
      messages,
      model: 'deepseek-flash',
      thinking: { type: 'enabled' as const },
    } as any);

    expect(payload.model).toBe('deepseek-flash');
    expect(payload.messages).toEqual(messages);
  });

  it('should handle no thinking param (defaults to standard mode)', () => {
    const payload = buildDeepSeekPayload({
      ...basePayload,
      temperature: 1,
    });
    expect(payload.temperature).toBe(1);
    expect(payload.thinking).toBeUndefined();
  });

  describe('thinking content block stripping', () => {
    it('should strip thinking blocks from assistant message content arrays', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Let me think...', signature: 'sig1' },
              { type: 'text', text: 'Here is the answer' },
            ],
          },
        ],
        thinking: { type: 'enabled' as const },
      });

      expect((payload.messages as any)[1].content).toEqual('Here is the answer');
    });

    it('should flatten to empty string when only thinking blocks exist', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Let me think...', signature: 'sig1' }],
          },
        ],
      });

      expect((payload.messages as any)[1].content).toBe('');
    });

    it('should preserve user messages unchanged', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      });

      expect((payload.messages as any)[0].content).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('should preserve string content on assistant messages', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [{ role: 'assistant', content: 'Plain text response' }],
      });

      expect((payload.messages as any)[0].content).toBe('Plain text response');
    });

    it('should preserve system messages unchanged', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [{ role: 'system', content: 'You are helpful' }],
      });

      expect((payload.messages as any)[0].content).toBe('You are helpful');
    });

    it('should keep multiple text blocks as an array after stripping thinking', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Hmm...', signature: 'sig1' },
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
            ],
          },
        ],
      });

      expect((payload.messages as any)[0].content).toEqual([
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' },
      ]);
    });

    it('should handle tool messages unchanged', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [{ role: 'tool', content: 'tool result', tool_call_id: 'call_1' }],
      });

      expect((payload.messages as any)[0].content).toBe('tool result');
    });
  });
});

describe('LobeDeepSeekAI debug', () => {
  it('reports DeepSeek cache hit and miss counters as supported telemetry', async () => {
    const instance = new LobeDeepSeekAI({ apiKey: 'test-key' });
    const events: any[] = [];
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue({
      choices: [],
      created: 123,
      id: 'private-response-id',
      model: 'deepseek-v4-pro',
      object: 'chat.completion',
      usage: {
        completion_tokens: 10,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
        prompt_tokens: 100,
        total_tokens: 110,
      },
    });

    const response = await instance.chat(
      {
        messages: [{ content: 'PRIVATE_DEEPSEEK_PROMPT', role: 'user' }],
        model: 'deepseek-v4-pro',
        responseMode: 'json',
        stream: false,
      } as any,
      {
        cacheDiagnostics: {
          emit: (event) => events.push(event),
          fingerprint: (scope) => `${scope}-fingerprint`,
          provider: 'deepseek',
          runtimeFamily: 'openai-compatible',
        },
      },
    );
    await response.json();

    expect(events).toEqual([
      expect.objectContaining({
        cacheMechanism: 'automatic',
        cacheSupport: 'supported',
        type: 'request',
      }),
      expect.objectContaining({
        cacheStatus: 'mixed',
        cacheSupport: 'supported',
        type: 'usage',
        usage: expect.objectContaining({
          inputCacheMissTokens: 20,
          inputCachedTokens: 80,
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_DEEPSEEK_PROMPT');
    expect(JSON.stringify(events)).not.toContain('private-response-id');
  });

  it('logs structured request summary with DEBUG_DEEPSEEK_CHAT_COMPLETION', async () => {
    const instance = new LobeDeepSeekAI({ apiKey: 'test-key' });
    const chatChunk = {
      choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
      id: 'chatcmpl-deepseek-debug',
    };
    const mockStream = (async function* () {
      yield chatChunk;
    })();
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue(mockStream);
    vi.stubEnv('DEBUG_DEEPSEEK_CHAT_COMPLETION', '1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro',
        temperature: 0,
      } as any);
      await response.text();

      // The chunk-tap assembles the final stream record into {id, finishReason, text, ...}.
      const assembledChunkCall = logSpy.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          (args[0] as string).includes('"chatcmpl-deepseek-debug"') &&
          (args[0] as string).includes('"finishReason"'),
      );
      expect(assembledChunkCall).toBeDefined();
      expect(assembledChunkCall?.[0]).toContain('"text":"Hello"');

      const providerDebugCall = logSpy.mock.calls.find(
        ([label]) => label === '[provider-debug:request]',
      );
      expect(providerDebugCall).toBeDefined();
      expect(JSON.parse(providerDebugCall?.[1] as string)).toMatchObject({
        effectiveURL: {
          originHash: expect.stringMatching(/^[\da-f]{8}$/),
          pathDepth: 2,
          pathHash: expect.stringMatching(/^[\da-f]{8}$/),
          present: true,
          queryKeys: [],
          relative: false,
        },
        model: 'deepseek-v4-pro',
        provider: 'deepseek',
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

describe('toDeepSeekAnthropicBaseURL', () => {
  it.each([
    [undefined, 'https://api.deepseek.com/anthropic'],
    ['https://api.deepseek.com', 'https://api.deepseek.com/anthropic'],
    ['https://api.deepseek.com/', 'https://api.deepseek.com/anthropic'],
    ['https://api.deepseek.com/v1', 'https://api.deepseek.com/anthropic'],
    ['https://proxy.example.com/deepseek/v1/', 'https://proxy.example.com/deepseek/anthropic'],
  ])('maps %s to %s', (baseURL, expected) => {
    expect(toDeepSeekAnthropicBaseURL(baseURL)).toBe(expected);
  });
});

describe('LobeDeepSeekAI built-in search routing', () => {
  // Event order captured from DeepSeek's Anthropic endpoint with web_search_20250305.
  const searchStream = () =>
    new ReadableStream({
      start(controller) {
        [
          {
            message: {
              content: [],
              id: 'msg_deepseek_search',
              model: 'deepseek-flash',
              role: 'assistant',
              stop_reason: null,
              stop_sequence: null,
              type: 'message',
              usage: { input_tokens: 10, output_tokens: 1 },
            },
            type: 'message_start',
          },
          {
            content_block: {
              id: 'call_00_search',
              input: {},
              name: 'web_search',
              type: 'server_tool_use',
            },
            index: 0,
            type: 'content_block_start',
          },
          {
            delta: { partial_json: '{"query":"DeepSeek news"}', type: 'input_json_delta' },
            index: 0,
            type: 'content_block_delta',
          },
          { index: 0, type: 'content_block_stop' },
          {
            content_block: {
              content: [
                {
                  title: 'DeepSeek updates',
                  type: 'web_search_result',
                  url: 'https://example.com',
                },
              ],
              tool_use_id: 'call_00_search',
              type: 'web_search_tool_result',
            },
            index: 1,
            type: 'content_block_start',
          },
          { index: 1, type: 'content_block_stop' },
          { content_block: { text: '', type: 'text' }, index: 2, type: 'content_block_start' },
          {
            delta: { text: 'Searched answer', type: 'text_delta' },
            index: 2,
            type: 'content_block_delta',
          },
          { index: 2, type: 'content_block_stop' },
          {
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            type: 'message_delta',
            usage: { output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
          },
          { type: 'message_stop' },
        ].forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });

  const setup = (options: Record<string, any> = {}) => {
    const instance = new LobeDeepSeekAI({ apiKey: 'test-key', ...options });
    const searchRuntime = (instance as any).getAnthropicSearchRuntime();
    const messagesCreate = vi
      .spyOn(searchRuntime['client'].messages, 'create')
      .mockImplementation(async () => searchStream() as any);
    const chatCompletionsCreate = vi.spyOn((instance as any).client.chat.completions, 'create');
    return { chatCompletionsCreate, instance, messagesCreate, searchRuntime };
  };

  it('sends search turns to the Anthropic endpoint with the server-side web_search tool', async () => {
    const { chatCompletionsCreate, instance, messagesCreate, searchRuntime } = setup();

    const response = await instance.chat({
      enabledSearch: true,
      messages: [{ content: 'What did DeepSeek announce?', role: 'user' }],
      model: 'deepseek-flash',
      reasoning_effort: 'max',
      thinking: { type: 'enabled' },
    } as any);
    const text = await response.text();

    expect(searchRuntime['client'].baseURL).toBe('https://api.deepseek.com/anthropic');
    const body = messagesCreate.mock.calls[0][0] as any;
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      output_config: { effort: 'max' },
      stream: true,
      thinking: { type: 'enabled' },
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.tools).toContainEqual(
      expect.objectContaining({ name: 'web_search', type: 'web_search_20250305' }),
    );
    // DeepSeek already ran the search; it must not reach the client as a tool call.
    expect(text).not.toContain('event: tool_calls');
    expect(text).toContain('Searched answer');
    expect(chatCompletionsCreate).not.toHaveBeenCalled();
  });

  it('keeps the raw 0-2 temperature and caller max_tokens when thinking is off', async () => {
    const { instance, messagesCreate } = setup({ baseURL: 'https://api.deepseek.com/v1' });

    const response = await instance.chat({
      enabledSearch: true,
      max_tokens: 1000,
      messages: [{ content: 'Search the news', role: 'user' }],
      model: 'deepseek-v4-pro',
      reasoning_effort: 'max',
      temperature: 1.5,
      thinking: { type: 'disabled' },
    } as any);
    await response.text();

    const body = messagesCreate.mock.calls[0][0] as any;
    expect(body).toMatchObject({
      max_tokens: 1000,
      model: 'deepseek-v4-pro',
      temperature: 1.5,
      thinking: { type: 'disabled' },
    });
    expect(body).not.toHaveProperty('output_config');
  });

  it('keeps turns without enabledSearch on Chat Completions', async () => {
    const { chatCompletionsCreate, instance, messagesCreate } = setup();
    chatCompletionsCreate.mockResolvedValue(
      (async function* () {
        yield {
          choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
          id: 'chatcmpl-deepseek',
        };
      })() as any,
    );

    const response = await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'deepseek-flash',
    } as any);
    await response.text();

    expect(chatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(chatCompletionsCreate.mock.calls[0][0]).not.toHaveProperty('enabledSearch');
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});
