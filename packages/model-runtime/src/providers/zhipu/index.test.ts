// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeZhipuAI, buildZhipuPayload } from './index';

const baseMessage = [{ content: 'hi', role: 'user' }];

describe('buildZhipuPayload', () => {
  it('omits the thinking field when thinking is enabled (official default = gateway-safe ON form)', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toBeUndefined();
  });

  it('sends thinking.type disabled when payload thinking.type is disabled', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 0, type: 'disabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ type: 'disabled' });
  });

  it('sends Preserved Thinking as type-less { clear_thinking: false } and strips budget_tokens', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, clear_thinking: false, type: 'enabled' },
    } as any) as any;
    // Gateway-safe enabled form: no `type` key (gateways reject the literal
    // type:"enabled"; official API defaults type to enabled).
    expect(out.thinking).toEqual({ clear_thinking: false });
    expect(out.thinking.type).toBeUndefined();
    expect(out.thinking.budget_tokens).toBeUndefined();
  });

  it('strips Moonshot-style keep field when set on thinking', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, keep: 'all', type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toBeUndefined();
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

  it('passes reasoning_effort through verbatim for glm-5.2 (skip already mapped to none by the service)', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      reasoning_effort: 'none',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.reasoning_effort).toBe('none');
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

  it('injects web_search tool and omits thinking (stays enabled) when enabledSearch is set on glm-5.2', () => {
    const out = buildZhipuPayload({
      enabledSearch: true,
      messages: baseMessage,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    // Search no longer forces `{ type: 'disabled' }`; the field is omitted like normal
    // thinking-ON so the body stays byte-stable for implicit prefix caching.
    expect(out.thinking).toBeUndefined();
    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.tools.some((t: any) => t.type === 'web_search')).toBe(true);
    expect(out.tool_choice).toBe('auto');
  });

  it('never sends tool_stream, even with function tools + stream + search', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildZhipuPayload({
      enabledSearch: true,
      messages: baseMessage,
      model: 'glm-5.2',
      stream: true,
      tools,
    } as any) as any;
    expect(out.tool_stream).toBeUndefined();
    expect(out.tools.some((t: any) => t.type === 'web_search')).toBe(true);
  });

  it('never sends tool_stream for glm-4.6 with function tools + stream', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-4.6',
      stream: true,
      tools,
    } as any) as any;
    expect(out.tool_stream).toBeUndefined();
  });

  it('keeps thinking enabled when response_format json_object is set on glm-5.2', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.2',
      response_format: { type: 'json_object' },
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toBeUndefined();
    expect(out.response_format).toEqual({ type: 'json_object' });
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
    expect(out.tool_stream).toBeUndefined();
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

  it('strips bare assistant reasoning_content when Preserved Thinking is off', () => {
    const messages: any = [
      ...baseMessage,
      { content: 'answer', reasoning_content: 'secret thoughts', role: 'assistant' },
    ];
    const out = buildZhipuPayload({
      messages,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, clear_thinking: true, type: 'enabled' },
    } as any) as any;
    expect(out.messages.some((m: any) => m.reasoning_content !== undefined)).toBe(false);
  });

  it('keeps bare assistant reasoning_content when Preserved Thinking is on', () => {
    const messages: any = [
      ...baseMessage,
      { content: 'answer', reasoning_content: 'secret thoughts', role: 'assistant' },
    ];
    const out = buildZhipuPayload({
      messages,
      model: 'glm-5.2',
      thinking: { budget_tokens: 1024, clear_thinking: false, type: 'enabled' },
    } as any) as any;
    expect(out.messages.some((m: any) => m.reasoning_content !== undefined)).toBe(true);
  });

  it('never sends thinking.type disabled for glm-5.3 even when payload asks disabled', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.3',
      reasoning_effort: 'max',
      thinking: { budget_tokens: 0, type: 'disabled' },
    } as any) as any;
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning_effort).toBe('max');
  });

  it('never sends thinking.type disabled for glm-5.3-flash', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.3-flash',
      thinking: { type: 'disabled' },
    } as any) as any;
    expect(out.thinking).toBeUndefined();
  });

  it('clamps glm-5.3 reasoning_effort none/skip/minimal to low', () => {
    for (const effort of ['none', 'skip', 'minimal'] as const) {
      const out = buildZhipuPayload({
        messages: baseMessage,
        model: 'glm-5.3',
        reasoning_effort: effort,
        thinking: { type: 'enabled' },
      } as any) as any;
      expect(out.reasoning_effort).toBe('low');
    }
  });

  it('forwards glm-5.3 reasoning_effort low/high/max verbatim', () => {
    for (const effort of ['low', 'high', 'max'] as const) {
      const out = buildZhipuPayload({
        messages: baseMessage,
        model: 'glm-5.3',
        reasoning_effort: effort,
        thinking: { type: 'enabled' },
      } as any) as any;
      expect(out.reasoning_effort).toBe(effort);
    }
  });

  it('sends Preserved Thinking as type-less { clear_thinking: false } on glm-5.3', () => {
    const out = buildZhipuPayload({
      messages: baseMessage,
      model: 'glm-5.3',
      thinking: { budget_tokens: 1024, clear_thinking: false, type: 'enabled' },
    } as any) as any;
    expect(out.thinking).toEqual({ clear_thinking: false });
    expect(out.thinking.type).toBeUndefined();
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
