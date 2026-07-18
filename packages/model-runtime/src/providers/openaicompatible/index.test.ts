// @vitest-environment node
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleAI } from './index';

vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeOpenAICompatibleAI', () => {
  let instance: InstanceType<typeof LobeOpenAICompatibleAI>;
  let originalCacheDebug: string | undefined;
  let originalResponsesDebug: string | undefined;

  beforeEach(() => {
    originalCacheDebug = process.env.DEBUG_OPENAICOMPATIBLE_CACHE;
    originalResponsesDebug = process.env.DEBUG_OPENAICOMPATIBLE_RESPONSES;
    instance = new LobeOpenAICompatibleAI({
      apiKey: 'test',
      baseURL: 'https://gateway.example.com/v1',
    });

    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalCacheDebug === undefined) delete process.env.DEBUG_OPENAICOMPATIBLE_CACHE;
    else process.env.DEBUG_OPENAICOMPATIBLE_CACHE = originalCacheDebug;
    if (originalResponsesDebug === undefined) delete process.env.DEBUG_OPENAICOMPATIBLE_RESPONSES;
    else process.env.DEBUG_OPENAICOMPATIBLE_RESPONSES = originalResponsesDebug;
  });

  it('uses Chat Completions by default', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();
    expect(instance['client'].responses.create).not.toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      stream: true,
    });
    expect(createCall).not.toHaveProperty('apiMode');
  });

  it('strips explicit Chat Completions mode from provider payload', async () => {
    await instance.chat({
      apiMode: 'chatCompletion',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).not.toHaveProperty('apiMode');
  });

  it('sends prompt-key-store Chat Completions cache hints upstream', async () => {
    await instance.chat({
      messages: [
        { content: 'Keep the response brief.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ],
      model: 'gpt-5.5',
      openAICompatCache: {
        chat: {
          promptCacheKey: true,
          sessionHeader: false,
        },
        preset: 'prompt-key-store',
        responses: {
          promptCacheKey: 'derived',
          sessionHeader: false,
          store: 'true',
        },
      },
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    const createOptions = (instance['client'].chat.completions.create as Mock).mock.calls[0][1];

    expect(createCall.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
    expect(createCall).not.toHaveProperty('openAICompatCache');
    expect(createOptions.headers).not.toHaveProperty('Session_id');
  });

  it('uses Responses API when apiMode is responses', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    expect(instance['client'].responses.create).toHaveBeenCalled();
    expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      model: 'gpt-5.5',
      stream: true,
    });
    expect(createCall).not.toHaveProperty('apiMode');
    expect(createCall).not.toHaveProperty('store');
    expect(createCall.input).toEqual([{ content: 'Hello', role: 'user' }]);
  });

  it('sends prompt-key-store Responses cache hints and omits extra parameter fields', async () => {
    await instance.chat({
      apiMode: 'responses',
      max_output_tokens: 512,
      max_tokens: 4096,
      messages: [
        { content: 'Keep the response brief.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ],
      model: 'gpt-5.5',
      openAICompatCache: {
        chat: {
          promptCacheKey: true,
          sessionHeader: false,
        },
        preset: 'prompt-key-store',
        responses: {
          promptCacheKey: 'derived',
          sessionHeader: false,
          store: 'true',
        },
      },
      openAICompatResponsesParams: {
        maxOutputTokens: false,
        maxTokens: false,
        truncation: 'off',
        verbosity: 'off',
      },
      responseStateMode: 'provider',
      truncation: 'auto',
      verbosity: 'medium',
    } as any);

    expect(instance['client'].responses.create).toHaveBeenCalled();
    expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    const createOptions = (instance['client'].responses.create as Mock).mock.calls[0][1];

    expect(createCall.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
    expect(createCall).not.toHaveProperty('max_output_tokens');
    expect(createCall).not.toHaveProperty('max_tokens');
    expect(createCall).not.toHaveProperty('openAICompatCache');
    expect(createCall).not.toHaveProperty('openAICompatResponsesParams');
    expect(createCall).not.toHaveProperty('responseStateMode');
    expect(createCall.store).toBe(true);
    expect(createCall).not.toHaveProperty('text');
    expect(createCall).not.toHaveProperty('truncation');
    expect(createCall).not.toHaveProperty('verbosity');
    expect(createOptions.headers).not.toHaveProperty('Session_id');
  });

  it('derives Chat Completions prompt_cache_key for non gpt-5/codex models when matrix enables it', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-3-5-sonnet',
      openAICompatCache: {
        chat: { promptCacheKey: true, sessionHeader: false },
        preset: 'prompt-key-store',
        responses: { promptCacheKey: 'derived', sessionHeader: false, store: 'true' },
      },
    });

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
  });

  it('derives Responses cache hints for non gpt-5/codex models when matrix enables them', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'qwen-max',
      openAICompatCache: {
        chat: { promptCacheKey: true, sessionHeader: false },
        preset: 'custom',
        responses: { promptCacheKey: 'derived', sessionHeader: true, store: 'true' },
      },
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    const createOptions = (instance['client'].responses.create as Mock).mock.calls[0][1];

    expect(createCall.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
    expect(createOptions.headers.Session_id).toBe(createCall.prompt_cache_key);
  });

  it('keeps the model allowlist for the legacy no-matrix responses path', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-3-5-sonnet',
      responseStateMode: 'provider',
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).not.toHaveProperty('prompt_cache_key');
    // legacy stateful mode still stores provider-side
    expect(createCall.store).toBe(true);
  });

  it('omits store for custom matrix store:default while still sending prompt_cache_key', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      openAICompatCache: {
        chat: { promptCacheKey: false, sessionHeader: false },
        preset: 'custom',
        responses: { promptCacheKey: 'derived', sessionHeader: false, store: 'default' },
      },
      responseStateMode: 'provider',
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
    expect(createCall).not.toHaveProperty('store');
  });

  it('forwards reasoning in Responses mode', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      reasoning: { effort: 'high' },
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall.reasoning).toMatchObject({ effort: 'high' });
  });

  it('forwards Sol max reasoning effort in Chat Completions mode', async () => {
    await instance.chat({
      enabledSearch: false,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6-sol',
      provider: 'openaicompatible',
      reasoning: { effort: 'low' },
      reasoning_effort: 'max',
      responseMode: 'stream',
    });

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'max',
    });
    expect(createCall).not.toHaveProperty('enabledSearch');
    expect(createCall).not.toHaveProperty('provider');
    expect(createCall).not.toHaveProperty('reasoning');
    expect(createCall).not.toHaveProperty('responseMode');
  });

  it('maps Sol max reasoning effort into Responses mode', async () => {
    await instance.chat({
      apiMode: 'responses',
      enabledContextCaching: true,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6-sol',
      provider: 'openaicompatible',
      reasoning_effort: 'max',
      reasoning_split: true,
      responseMode: 'stream',
    });

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'max' },
    });
    expect(createCall).not.toHaveProperty('apiMode');
    expect(createCall).not.toHaveProperty('enabledContextCaching');
    expect(createCall).not.toHaveProperty('provider');
    expect(createCall).not.toHaveProperty('reasoning_effort');
    expect(createCall).not.toHaveProperty('reasoning_split');
    expect(createCall).not.toHaveProperty('responseMode');
  });

  it('ignores the removed Responses reasoning shape selector', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6-sol',
      openAICompatResponsesParams: { reasoningEffort: 'top-level' } as any,
      provider: 'openaicompatible',
      reasoning_effort: 'high',
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'high' },
    });
    expect(createCall).not.toHaveProperty('reasoning_effort');
    expect(createCall).not.toHaveProperty('openAICompatResponsesParams');
  });

  it('preserves Responses reasoning options while applying model effort', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      openAICompatResponsesParams: { reasoningEffort: 'off' } as any,
      provider: 'openaicompatible',
      reasoning: { effort: 'low', summary: 'auto' },
      reasoning_effort: 'high',
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    expect(createCall).not.toHaveProperty('reasoning_effort');
  });

  it('does not serialize historical reasoning into Responses input', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [
        { content: 'Hello', role: 'user' },
        {
          content: 'Earlier answer',
          reasoning: { content: 'historical chain of thought' },
          reasoning_content: 'legacy reasoning content',
          role: 'assistant',
        },
        { content: 'Follow-up', role: 'user' },
      ],
      model: 'gpt-5.5',
    } as any);

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    const reasoningItems = createCall.input.filter((item: any) => item.type === 'reasoning');
    expect(reasoningItems).toHaveLength(0);
    expect(createCall.input).toEqual([
      { content: 'Hello', role: 'user' },
      { content: 'Earlier answer', role: 'assistant' },
      { content: 'Follow-up', role: 'user' },
    ]);
  });

  it('forwards documented Chat Completions fields and strips internal routing fields', async () => {
    await instance.chat({
      enabledContextCaching: true,
      enabledSearch: false,
      frequency_penalty: 0.5,
      max_tokens: 4096,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      presence_penalty: 0.3,
      provider: 'openaicompatible',
      reasoning: { effort: 'high' },
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      text: { verbosity: 'low' },
      tool_choice: 'auto',
      tools: [{ function: { name: 'f', parameters: {} }, type: 'function' }],
      top_p: 0.9,
      truncation: 'auto',
      verbosity: 'medium',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalled();

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];

    // Documented Chat Completions fields forwarded
    expect(createCall).toMatchObject({
      frequency_penalty: 0.5,
      max_tokens: 4096,
      model: 'gpt-5.5',
      presence_penalty: 0.3,
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      tool_choice: 'auto',
      tools: [{ function: { name: 'f', parameters: {} }, type: 'function' }],
      top_p: 0.9,
    });

    // Responses-API-only fields stripped in Chat Completions mode
    expect(createCall).not.toHaveProperty('reasoning');
    expect(createCall).not.toHaveProperty('text');
    expect(createCall).not.toHaveProperty('verbosity');
    expect(createCall).not.toHaveProperty('truncation');

    // Internal routing / feature fields stripped
    expect(createCall).not.toHaveProperty('apiMode');
    expect(createCall).not.toHaveProperty('enabledContextCaching');
    expect(createCall).not.toHaveProperty('enabledSearch');
    expect(createCall).not.toHaveProperty('provider');
    expect(createCall).not.toHaveProperty('responseMode');
    expect(createCall).not.toHaveProperty('thinkingBudget');
    expect(createCall).not.toHaveProperty('urlContext');
    expect(createCall).not.toHaveProperty('reasoning_split');
  });

  it('strips undefined optional fields instead of sending them as null', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
    });

    const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
    expect(createCall).not.toHaveProperty('temperature');
    expect(createCall).not.toHaveProperty('top_p');
    expect(createCall).not.toHaveProperty('max_tokens');
    expect(createCall).not.toHaveProperty('tools');
    expect(createCall).not.toHaveProperty('reasoning');
    expect(createCall).not.toHaveProperty('text');
    expect(createCall).not.toHaveProperty('verbosity');
    expect(createCall).not.toHaveProperty('truncation');
  });

  it('normalizes portable Responses fields in Responses mode', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      max_output_tokens: 512,
      max_tokens: 4096,
      model: 'gpt-5.5',
      openAICompatResponsesParams: {
        maxOutputTokens: false,
        maxTokens: false,
        truncation: 'off',
        verbosity: 'text',
      },
      truncation: 'auto',
      verbosity: 'medium',
    } as any);

    expect(instance['client'].responses.create).toHaveBeenCalled();

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      model: 'gpt-5.5',
      text: { verbosity: 'medium' },
    });
    expect(createCall).not.toHaveProperty('max_output_tokens');
    expect(createCall).not.toHaveProperty('max_tokens');
    expect(createCall).not.toHaveProperty('truncation');
    expect(createCall).not.toHaveProperty('verbosity');
  });

  it('allows custom Responses parameter compatibility fields when configured', async () => {
    await instance.chat({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      max_output_tokens: 512,
      max_tokens: 4096,
      model: 'gpt-5.5',
      openAICompatResponsesParams: {
        maxOutputTokens: true,
        maxTokens: true,
        truncation: 'auto',
        verbosity: 'both',
      },
      text: { verbosity: 'low' },
      truncation: 'disabled',
      verbosity: 'medium',
    } as any);

    expect(instance['client'].responses.create).toHaveBeenCalled();

    const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
    expect(createCall).toMatchObject({
      max_output_tokens: 512,
      max_tokens: 4096,
      model: 'gpt-5.5',
      text: { verbosity: 'medium' },
      truncation: 'auto',
      verbosity: 'medium',
    });
  });

  it('enables Responses debug stream logging with DEBUG_OPENAICOMPATIBLE_RESPONSES', async () => {
    process.env.DEBUG_OPENAICOMPATIBLE_RESPONSES = '1';
    const responseEvents = [
      {
        response: { id: 'resp_debug', status: 'in_progress' },
        type: 'response.created',
      },
      {
        response: { id: 'resp_debug', status: 'completed' },
        type: 'response.completed',
      },
    ];
    const mockStream = (async function* () {
      yield* responseEvents;
    })();
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValueOnce(mockStream as any);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const response = await instance.chat({
        apiMode: 'responses',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-5.5',
      });
      await response.text();

      expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(responseEvents[1]));
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it('logs redacted cache debug summaries without raw prompt text', async () => {
    process.env.DEBUG_OPENAICOMPATIBLE_CACHE = '1';
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await instance.chat({
      messages: [
        { content: 'System secret text', role: 'system' },
        { content: 'User secret text', role: 'user' },
      ],
      model: 'gpt-5.5',
      openAICompatCache: {
        chat: {
          promptCacheKey: true,
          sessionHeader: false,
        },
        preset: 'prompt-key-store',
      },
      tools: [
        {
          function: {
            name: 'lookup_private_data',
            parameters: { properties: { query: { type: 'string' } }, type: 'object' },
          },
          type: 'function',
        },
      ],
    });

    const cacheLog = consoleLogSpy.mock.calls.find(
      ([label]) => label === '[openai-compatible-cache-debug:request]',
    );

    expect(cacheLog).toBeDefined();
    const summary = JSON.parse(cacheLog![1] as string);
    expect(summary).toMatchObject({
      cache: {
        promptCacheKey: { present: true },
        sessionId: { present: false },
      },
      effectiveURL: {
        originHash: expect.stringMatching(/^[\da-f]{8}$/),
        pathDepth: 3,
        pathHash: expect.stringMatching(/^[\da-f]{8}$/),
        present: true,
        queryKeys: [],
        relative: false,
      },
      model: 'gpt-5.5',
      route: '/chat/completions',
      tools: {
        count: 1,
        fingerprint: expect.stringMatching(/^[\da-f]{8}$/),
      },
      turnShape: {
        count: 2,
        sequence: ['system:text', 'user:text'],
      },
    });
    expect(cacheLog![1]).not.toContain('System secret text');
    expect(cacheLog![1]).not.toContain('User secret text');
    expect(cacheLog![1]).not.toContain('gateway.example.com');
    expect(cacheLog![1]).not.toContain('lookup_private_data');
    expect(cacheLog![1]).not.toContain('properties');

    consoleLogSpy.mockRestore();
  });

  it('logs redacted Responses cache debug summaries without raw prompt text', async () => {
    process.env.DEBUG_OPENAICOMPATIBLE_CACHE = '1';
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await instance.chat({
      apiMode: 'responses',
      messages: [
        { content: 'System secret text', role: 'system' },
        { content: 'User secret text', role: 'user' },
      ],
      model: 'gpt-5.5',
      openAICompatCache: {
        preset: 'prompt-key-store',
        responses: {
          promptCacheKey: 'derived',
          sessionHeader: false,
          store: 'true',
        },
      },
      openAICompatResponsesParams: {
        maxOutputTokens: false,
        maxTokens: false,
        truncation: 'off',
        verbosity: 'off',
      },
      responseStateMode: 'provider',
      verbosity: 'medium',
    } as any);

    const cacheLog = consoleLogSpy.mock.calls.find(
      ([label]) => label === '[openai-compatible-cache-debug:request]',
    );

    expect(cacheLog).toBeDefined();
    const summary = JSON.parse(cacheLog![1] as string);
    expect(summary).toMatchObject({
      cache: {
        promptCacheKey: { present: true },
        sessionId: { present: false },
        store: true,
      },
      effectiveURL: {
        originHash: expect.stringMatching(/^[\da-f]{8}$/),
        pathDepth: 2,
        pathHash: expect.stringMatching(/^[\da-f]{8}$/),
        present: true,
        queryKeys: [],
        relative: false,
      },
      model: 'gpt-5.5',
      params: {
        hasTextVerbosity: false,
        hasTopLevelVerbosity: false,
      },
      route: '/responses',
      turnShape: {
        count: 2,
        sequence: ['developer:text', 'user:text'],
      },
    });
    expect(cacheLog![1]).not.toContain('System secret text');
    expect(cacheLog![1]).not.toContain('User secret text');
    expect(cacheLog![1]).not.toContain('gateway.example.com');

    consoleLogSpy.mockRestore();
  });
});
