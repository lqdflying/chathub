// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeMimoAI, buildMimoPayload } from './index';

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

  it('strips sampling params when thinking is enabled', () => {
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
    expect(payload.frequency_penalty).toBeUndefined();
    expect(payload.presence_penalty).toBeUndefined();
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
