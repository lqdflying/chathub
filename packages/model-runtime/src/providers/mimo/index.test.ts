// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeMimoAI, buildMimoPayload, isMimoTokenPlanBaseURL } from './index';

describe('buildMimoPayload', () => {
  const basePayload = {
    messages: [{ content: 'Hello', role: 'user' }],
    model: 'mimo-v2.5-pro',
  } as any;

  it('passes through sampling params when thinking is disabled', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      temperature: 0.8,
      thinking: { type: 'disabled' as const },
      top_p: 0.9,
    });

    expect(payload.model).toBe('mimo-v2.5-pro');
    expect(payload.temperature).toBe(0.8);
    expect(payload.top_p).toBe(0.9);
    expect(payload.frequency_penalty).toBe(0.5);
    expect(payload.presence_penalty).toBe(0.3);
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.stream).toBe(true);
  });

  it('does not forward ChatHub-internal fields that Token Plan rejects as 400', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      apiMode: 'chatCompletion',
      catalogModel: 'mimo-v2.5-pro',
      enabledContextCaching: true,
      n: 1,
      provider: 'mimo',
      reasoning_effort: 'high',
      responseMode: 'stream',
      thinking: { type: 'disabled' as const },
    } as any);

    expect(payload).not.toHaveProperty('apiMode');
    expect(payload).not.toHaveProperty('catalogModel');
    expect(payload).not.toHaveProperty('enabledContextCaching');
    expect(payload).not.toHaveProperty('n');
    expect(payload).not.toHaveProperty('provider');
    expect(payload).not.toHaveProperty('reasoning_effort');
    expect(payload).not.toHaveProperty('responseMode');
    expect(payload).not.toHaveProperty('enabledSearch');
  });

  it('clamps temperature and top_p to Xiaomi ranges when thinking is off', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      temperature: 2,
      thinking: { type: 'disabled' as const },
      top_p: 0,
    });

    expect(payload.temperature).toBe(1.5);
    expect(payload.top_p).toBe(0.01);
  });

  it('omits only temperature and top_p when thinking is enabled', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      temperature: 0.8,
      thinking: { type: 'enabled' as const },
      top_p: 0.9,
    });

    expect(payload.temperature).toBeUndefined();
    expect(payload.top_p).toBeUndefined();
    expect(payload.frequency_penalty).toBe(0.5);
    expect(payload.presence_penalty).toBe(0.3);
    expect(payload.thinking).toEqual({ type: 'enabled' });
  });

  it('maps max_tokens to max_completion_tokens and omits max_tokens', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      max_tokens: 256,
      thinking: { type: 'disabled' as const },
    });

    expect((payload as any).max_completion_tokens).toBe(256);
    expect(payload).not.toHaveProperty('max_tokens');
  });

  it('keeps thinking.type only and drops budget_tokens', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      thinking: { budget_tokens: 1024, type: 'enabled' },
    });

    expect(payload.thinking).toEqual({ type: 'enabled' });
    expect((payload.thinking as any).budget_tokens).toBeUndefined();
  });

  it('injects type: web_search when enabledSearch is set and does not disable thinking', () => {
    const tools = [
      {
        function: { description: 'Test tool', name: 'test' },
        type: 'function' as const,
      },
    ];
    const payload = buildMimoPayload({
      ...basePayload,
      enabledSearch: true,
      thinking: { type: 'enabled' as const },
      tools,
    });

    expect(payload.thinking).toEqual({ type: 'enabled' });
    expect(payload.tools).toEqual([...tools, { type: 'web_search' }]);
    expect(payload).not.toHaveProperty('enabledSearch');
  });

  it('sends only web_search when enabledSearch is set without other tools', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      enabledSearch: true,
    });

    expect(payload.tools).toEqual([{ type: 'web_search' }]);
  });

  it('omits native web_search on Token Plan hosts even when enabledSearch is set', () => {
    const tools = [
      {
        function: { description: 'Search the web', name: 'tavily____tavily_search____mcp' },
        type: 'function' as const,
      },
    ];
    const payload = buildMimoPayload(
      {
        ...basePayload,
        enabledSearch: true,
        tools,
      },
      { baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' },
    );

    expect(payload.tools).toEqual(tools);
    expect(payload.tools).not.toEqual(expect.arrayContaining([{ type: 'web_search' }]));
  });

  it('omits tools entirely on Token Plan when the only search tool would be native web_search', () => {
    const payload = buildMimoPayload(
      {
        ...basePayload,
        enabledSearch: true,
      },
      { baseURL: 'https://token-plan-ams.xiaomimimo.com/v1' },
    );

    expect(payload).not.toHaveProperty('tools');
  });

  it('strips an existing web_search tool on Token Plan hosts', () => {
    const payload = buildMimoPayload(
      {
        ...basePayload,
        tools: [
          { function: { name: 'keep_me' }, type: 'function' as const },
          { type: 'web_search' } as any,
        ],
      },
      { baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' },
    );

    expect(payload.tools).toEqual([{ function: { name: 'keep_me' }, type: 'function' }]);
  });

  it('still injects web_search on the pay-as-you-go host', () => {
    const payload = buildMimoPayload(
      {
        ...basePayload,
        enabledSearch: true,
      },
      { baseURL: 'https://api.xiaomimimo.com/v1' },
    );

    expect(payload.tools).toEqual([{ type: 'web_search' }]);
  });

  it('coerces non-auto tool_choice to auto', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      tool_choice: 'required',
      tools: [{ function: { name: 'test' }, type: 'function' as const }],
    });

    expect(payload.tool_choice).toBe('auto');
  });

  it('leaves tool_choice auto unchanged', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      tool_choice: 'auto',
      tools: [{ function: { name: 'test' }, type: 'function' as const }],
    });

    expect(payload.tool_choice).toBe('auto');
  });

  it('adds empty reasoning_content on assistant tool_calls when thinking is enabled', () => {
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [
        { content: 'Search now', role: 'user' },
        { content: '', role: 'assistant', tool_calls: [toolCall] },
        { content: 'Search result', role: 'tool', tool_call_id: toolCall.id },
      ],
      thinking: { type: 'enabled' as const },
    });

    expect((payload.messages as any[])[1]).toMatchObject({
      reasoning_content: '',
      role: 'assistant',
      tool_calls: [toolCall],
    });
  });

  it('leaves stored reasoning.content untouched so the converter can map it', () => {
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [
        {
          content: '',
          reasoning: { content: 'must preserve this' },
          role: 'assistant',
          tool_calls: [toolCall],
        },
      ],
      thinking: { type: 'enabled' as const },
    } as any);

    expect((payload.messages as any[])[0].reasoning_content).toBeUndefined();
    expect((payload.messages as any[])[0].reasoning).toEqual({ content: 'must preserve this' });
  });

  it('replaces empty reasoning_content with stored reasoning.content', () => {
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [
        {
          content: '',
          reasoning: { content: 'must preserve this' },
          reasoning_content: '',
          role: 'assistant',
          tool_calls: [toolCall],
        },
      ],
      thinking: { type: 'enabled' as const },
    } as any);

    expect((payload.messages as any[])[0].reasoning_content).toBe('must preserve this');
  });

  it('replaces null reasoning_content with stored reasoning.content', () => {
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [
        {
          content: '',
          reasoning: { content: 'must preserve this' },
          reasoning_content: null,
          role: 'assistant',
          tool_calls: [toolCall],
        },
      ],
      thinking: { type: 'enabled' as const },
    } as any);

    expect((payload.messages as any[])[0].reasoning_content).toBe('must preserve this');
  });

  it('preserves existing reasoning_content on assistant tool_calls', () => {
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [
        {
          content: '',
          reasoning_content: 'need a tool',
          role: 'assistant',
          tool_calls: [toolCall],
        },
      ],
      thinking: { type: 'enabled' as const },
    } as any);

    expect((payload.messages as any[])[0].reasoning_content).toBe('need a tool');
  });

  it('does not invent reasoning_content on tool turns when thinking is disabled', () => {
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [{ content: '', role: 'assistant', tool_calls: [toolCall] }],
      thinking: { type: 'disabled' as const },
    });

    expect((payload.messages as any[])[0]).not.toHaveProperty('reasoning_content');
  });

  it('strips Anthropic-style thinking content blocks from assistant messages', () => {
    const payload = buildMimoPayload({
      ...basePayload,
      messages: [
        { content: 'Hello', role: 'user' },
        {
          content: [
            { signature: 'sig1', thinking: 'Let me think...', type: 'thinking' },
            { text: 'Here is the answer', type: 'text' },
          ],
          role: 'assistant',
        },
      ],
      thinking: { type: 'enabled' as const },
    });

    expect((payload.messages as any)[1].content).toBe('Here is the answer');
  });
});

describe('isMimoTokenPlanBaseURL', () => {
  it('matches regional Token Plan hosts', () => {
    expect(isMimoTokenPlanBaseURL('https://token-plan-cn.xiaomimimo.com/v1')).toBe(true);
    expect(isMimoTokenPlanBaseURL('https://token-plan-ams.xiaomimimo.com/v1')).toBe(true);
    expect(isMimoTokenPlanBaseURL('https://api.xiaomimimo.com/v1')).toBe(false);
    expect(isMimoTokenPlanBaseURL(undefined)).toBe(false);
  });
});

describe('LobeMimoAI chat', () => {
  it('maps stored reasoning.content through to reasoning_content on tool continuations', async () => {
    const instance = new LobeMimoAI({ apiKey: 'test-key' });
    const create = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue({
        choices: [{ message: { content: 'done', role: 'assistant' } }],
        created: 123,
        id: 'chatcmpl-mimo-reasoning',
        model: 'mimo-v2.5-pro',
        object: 'chat.completion',
      });
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };

    await instance.chat({
      messages: [
        { content: 'Search now', role: 'user' },
        {
          content: '',
          reasoning: { content: 'must preserve this' },
          role: 'assistant',
          tool_calls: [toolCall],
        },
        { content: 'result', role: 'tool', tool_call_id: 'call-1' },
      ],
      model: 'mimo-v2.5-pro',
      responseMode: 'json',
      stream: false,
      thinking: { type: 'enabled' },
    } as any);

    expect(create).toHaveBeenCalled();
    const body = create.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    const assistant = body.messages.find((message) => message.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('must preserve this');
  });

  it('maps stored reasoning.content when the bare field is null', async () => {
    const instance = new LobeMimoAI({ apiKey: 'test-key' });
    const create = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue({
        choices: [{ message: { content: 'done', role: 'assistant' } }],
        created: 123,
        id: 'chatcmpl-mimo-reasoning-null',
        model: 'mimo-v2.5-pro',
        object: 'chat.completion',
      });
    const toolCall = {
      function: { arguments: '{}', name: 'search' },
      id: 'call-1',
      type: 'function',
    };

    await instance.chat({
      messages: [
        { content: 'Search now', role: 'user' },
        {
          content: '',
          reasoning: { content: 'must preserve null case' },
          reasoning_content: null,
          role: 'assistant',
          tool_calls: [toolCall],
        },
        { content: 'result', role: 'tool', tool_call_id: 'call-1' },
      ],
      model: 'mimo-v2.5-pro',
      responseMode: 'json',
      stream: false,
      thinking: { type: 'enabled' },
    } as any);

    expect(create).toHaveBeenCalled();
    const body = create.mock.calls[0][0] as { messages: Array<Record<string, unknown>> };
    const assistant = body.messages.find((message) => message.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('must preserve null case');
  });

  it('does not send native web_search when the instance uses a Token Plan base URL', async () => {
    const instance = new LobeMimoAI({
      apiKey: 'test-key',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    });
    const create = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue({
        choices: [{ message: { content: 'ok', role: 'assistant' } }],
        created: 123,
        id: 'chatcmpl-mimo-token-plan',
        model: 'mimo-v2.5-pro',
        object: 'chat.completion',
      });

    await instance.chat({
      enabledSearch: true,
      messages: [{ content: 'hello', role: 'user' }],
      model: 'mimo-v2.5-pro',
      responseMode: 'json',
      stream: false,
      tools: [
        {
          function: { description: 'Search', name: 'tavily____tavily_search____mcp' },
          type: 'function',
        },
      ],
    } as any);

    const body = create.mock.calls[0][0] as { tools?: Array<{ type?: string }> };
    expect(body.tools).toEqual([
      {
        function: { description: 'Search', name: 'tavily____tavily_search____mcp' },
        type: 'function',
      },
    ]);
    expect(body.tools?.some((tool) => tool.type === 'web_search')).toBe(false);
  });
});

describe('LobeMimoAI debug', () => {
  it('reports MiMo cached_tokens as supported telemetry', async () => {
    const instance = new LobeMimoAI({ apiKey: 'test-key' });
    const events: any[] = [];
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue({
      choices: [],
      created: 123,
      id: 'private-response-id',
      model: 'mimo-v2.5-pro',
      object: 'chat.completion',
      usage: {
        completion_tokens: 10,
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 80 },
        total_tokens: 110,
      },
    });

    const response = await instance.chat(
      {
        messages: [{ content: 'PRIVATE_MIMO_PROMPT', role: 'user' }],
        model: 'mimo-v2.5-pro',
        responseMode: 'json',
        stream: false,
      } as any,
      {
        cacheDiagnostics: {
          emit: (event) => events.push(event),
          fingerprint: (scope) => `${scope}-fingerprint`,
          provider: 'mimo',
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
    expect(JSON.stringify(events)).not.toContain('PRIVATE_MIMO_PROMPT');
    expect(JSON.stringify(events)).not.toContain('private-response-id');
  });

  it('logs structured request summary with DEBUG_MIMO_CHAT_COMPLETION', async () => {
    const instance = new LobeMimoAI({ apiKey: 'test-key' });
    const chatChunk = {
      choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
      id: 'chatcmpl-mimo-debug',
    };
    const mockStream = (async function* () {
      yield chatChunk;
    })();
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue(mockStream);
    vi.stubEnv('DEBUG_MIMO_CHAT_COMPLETION', '1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mimo-v2.5-pro',
        temperature: 0,
      } as any);
      await response.text();

      const providerDebugCall = logSpy.mock.calls.find(
        ([label]) => label === '[provider-debug:request]',
      );
      expect(providerDebugCall).toBeDefined();
      expect(JSON.parse(providerDebugCall?.[1] as string)).toMatchObject({
        provider: 'mimo',
      });
    } finally {
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
