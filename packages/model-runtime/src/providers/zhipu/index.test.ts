// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeZhipuAI, buildZhipuPayload } from './index';

const baseMessage = [{ content: 'hi', role: 'user' }];

describe('buildZhipuPayload', () => {
  it('defaults thinking to enabled when omitted on a thinking-capable model', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
    } as any) as any;
    expect(out.thinking).toEqual({ type: 'enabled' });
  });

  it('sends thinking.type disabled when payload thinking.type is disabled', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 0, type: 'disabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ type: 'disabled' });
  });

  it('forwards clear_thinking=false when set on thinking and strips budget_tokens', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, clear_thinking: false, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ clear_thinking: false, type: 'enabled' });
    expect(out.thinking.budget_tokens).toBeUndefined();
  });

  it('strips Moonshot-style keep field when set on thinking', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, keep: 'all', type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ type: 'enabled' });
    expect(out.thinking.keep).toBeUndefined();
  });

  it('forwards reasoning_effort only when thinking is enabled', () => {
    const on = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      reasoning_effort: 'max',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(on.reasoning_effort).toBe('max');

    const off = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      reasoning_effort: 'max',
      thinking: { budget_tokens: 0, type: 'disabled' },
    } as any) as any;
    expect(off.reasoning_effort).toBeUndefined();
  });

  it('drops reasoning_effort for non-5.2 models even when thinking is on', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.1',
      reasoning_effort: 'max',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.reasoning_effort).toBeUndefined();
  });

  it('passes reasoning_effort through verbatim for glm-5.2', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      reasoning_effort: 'minimal',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    // runtime forwards the value as-is; the chat service maps 'skip' -> 'minimal'
    expect(out.reasoning_effort).toBe('minimal');
  });

  it('sets do_sample=false and omits temperature when temperature is 0', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      temperature: 0,
    } as any) as any;
    expect(out.do_sample).toBe(false);
    expect(out.temperature).toBeUndefined();
  });

  it('keeps temperature and top_p when not greedy', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      temperature: 0.7,
      top_p: 0.9,
    } as any) as any;
    expect(out.do_sample).toBeUndefined();
    expect(out.temperature).toBe(0.7);
    expect(out.top_p).toBe(0.9);
  });

  it('injects web_search tool and forces thinking disabled when enabledSearch is set on glm-5.2', () => {
    const out = buildZhipuPayload({
      enabledSearch: true,
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ type: 'disabled' });
    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.tools.some((t: any) => t.type === 'web_search')).toBe(true);
    expect(out.tool_choice).toBe('auto');
    // tool_stream only applies to function tools; a lone web_search tool does not set it.
    expect(out.tool_stream).toBeUndefined();
  });

  it('sets tool_stream when streaming with function tools', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildZhipuPayload({
      enabledSearch: true,
      messages: baseMessage,
      model: 'glm-5.2',
      stream: true,
      tools,
    } as any) as any;
    expect(out.tool_stream).toBe(true);
    expect(out.tools.some((t: any) => t.type === 'web_search')).toBe(true);
  });

  it('forces thinking disabled when response_format json_object is set on glm-5.2', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      response_format: { type: 'json_object' },
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ type: 'disabled' });
  });

  it('coerces tool_choice to auto when tools are present', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      stream: true,
      tools,
    } as any) as any;
    expect(out.tool_choice).toBe('auto');
    expect(out.tool_stream).toBe(true);
    expect(out.tools).toEqual([...tools]);
  });

  it('strips non-auto tool_choice variants', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      tool_choice: 'required',
      tools,
    } as any) as any;
    expect(out.tool_choice).toBe('auto');
  });

  it('omits tools and tool_choice when none provided', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
    } as any) as any;
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
    expect(out.tool_stream).toBeUndefined();
  });

  it('omits thinking param entirely for a non-thinking-capable model id', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-4-32b-0414-128k',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toBeUndefined();
  });

  it('strips internal assistant reasoning when Preserved Thinking is off', () => {
    const messages: any = [
      ...baseMessage,
      { content: 'answer', reasoning: { content: 'secret thoughts' }, role: 'assistant' },
    ];
    const out = buildZhipuPayload({
      messages,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, clear_thinking: true, type: 'enabled' },
    } as any) as any;
    expect(out.messages.some((m: any) => m.reasoning)).toBe(false);
  });

  it('keeps internal assistant reasoning when Preserved Thinking is on', () => {
    const messages: any = [
      ...baseMessage,
      { content: 'answer', reasoning: { content: 'secret thoughts' }, role: 'assistant' },
    ];
    const out = buildZhipuPayload({
      messages,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, clear_thinking: false, type: 'enabled' },
    } as any) as any;
    expect(out.messages.some((m: any) => m.reasoning)).toBe(true);
  });
});

describe('LobeZhipuAI debug', () => {
  it('logs structured request summary with DEBUG_ZHIPU_CHAT_COMPLETION', async () => {
    const instance = new LobeZhipuAI({ apiKey: 'test-key' });
    const chatChunk = {
      choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
      id: 'chatcmpl-zhipu-debug',
    };
    const mockStream = (async function* () {
      yield chatChunk;
    })();
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue(mockStream);
    vi.stubEnv('DEBUG_ZHIPU_CHAT_COMPLETION', '1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        max_tokens: 256,
        model: 'glm-5.2',
        stream: true,
      } as any);
      await response.text();

      // The chunk-tap assembles the final stream record into {id, finishReason, text, ...}.
      const assembledChunkCall = logSpy.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          (args[0] as string).includes('"chatcmpl-zhipu-debug"') &&
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
          pathDepth: expect.any(Number),
          pathHash: expect.stringMatching(/^[\da-f]{8}$/),
          present: true,
          queryKeys: [],
          relative: false,
        },
        model: 'glm-5.2',
        params: {
          hasMaxTokens: true,
        },
        provider: 'zhipu',
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
