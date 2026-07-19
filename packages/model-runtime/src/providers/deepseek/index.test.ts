// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeDeepSeekAI, buildDeepSeekPayload } from './index';

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
            content: [
              { type: 'thinking', thinking: 'Let me think...', signature: 'sig1' },
            ],
          },
        ],
      });

      expect((payload.messages as any)[1].content).toBe('');
    });

    it('should preserve user messages unchanged', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
      });

      expect((payload.messages as any)[0].content).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('should preserve string content on assistant messages', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [
          { role: 'assistant', content: 'Plain text response' },
        ],
      });

      expect((payload.messages as any)[0].content).toBe('Plain text response');
    });

    it('should preserve system messages unchanged', () => {
      const payload = buildDeepSeekPayload({
        ...basePayload,
        messages: [
          { role: 'system', content: 'You are helpful' },
        ],
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
        messages: [
          { role: 'tool', content: 'tool result', tool_call_id: 'call_1' },
        ],
      });

      expect((payload.messages as any)[0].content).toBe('tool result');
    });
  });
});

describe('LobeDeepSeekAI debug', () => {
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

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(chatChunk));
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
