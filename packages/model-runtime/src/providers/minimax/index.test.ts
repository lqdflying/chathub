// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeMinimaxAI, buildMinimaxOpenAIChatPayload } from './index';

describe('buildMinimaxOpenAIChatPayload', () => {
  it('defaults reasoning_split to true when payload omits it', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
    } as any);
    expect(out.reasoning_split).toBe(true);
  });

  it('uses MiniMax-M3 model-bank max output when max_tokens is omitted', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M3',
    } as any);

    expect(out.max_tokens).toBe(32_768);
    expect(out.reasoning_split).toBe(true);
  });

  it('connectivity probe keeps reasoning_split false and respects max_tokens', () => {
    const out = buildMinimaxOpenAIChatPayload({
      max_tokens: 256,
      messages: [{ content: 'hello', role: 'user' }],
      model: 'MiniMax-M2.5',
      reasoning_split: false,
    } as any);

    expect(out.reasoning_split).toBe(false);
    expect(out.max_tokens).toBe(256);
  });

  it('sets reasoning_split false when payload has reasoning_split: false', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
      reasoning_split: false,
    } as any);
    expect(out.reasoning_split).toBe(false);
  });

  it('passes tools through', () => {
    const tools = [{ function: { name: 'x', parameters: {} }, type: 'function' }] as any;
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.5',
      reasoning_split: true,
      tools,
    } as any);
    expect(out.tools).toEqual(tools);
  });

  it('drops OpenAI image detail auto and keeps MiniMax low/default/high', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [
        {
          content: [
            { text: 'what is this', type: 'text' },
            {
              image_url: { detail: 'auto', url: 'data:image/png;base64,abc' },
              type: 'image_url',
            },
            {
              image_url: { detail: 'high', url: 'https://example.com/hi.png' },
              type: 'image_url',
            },
            {
              image_url: { detail: 'default', url: 'https://example.com/def.png' },
              type: 'image_url',
            },
            {
              image_url: { url: 'https://example.com/plain.png' },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
      ],
      model: 'MiniMax-M3',
    } as any);

    expect(out.messages[0].content).toEqual([
      { text: 'what is this', type: 'text' },
      { image_url: { url: 'data:image/png;base64,abc' }, type: 'image_url' },
      {
        image_url: { detail: 'high', url: 'https://example.com/hi.png' },
        type: 'image_url',
      },
      {
        image_url: { detail: 'default', url: 'https://example.com/def.png' },
        type: 'image_url',
      },
      { image_url: { url: 'https://example.com/plain.png' }, type: 'image_url' },
    ]);
  });

  it('drops OpenAI video detail auto', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [
        {
          content: [
            {
              type: 'video_url',
              video_url: { detail: 'auto', url: 'https://example.com/clip.mp4' },
            },
          ],
          role: 'user',
        },
      ],
      model: 'MiniMax-M3',
    } as any);

    expect(out.messages[0].content).toEqual([
      { type: 'video_url', video_url: { url: 'https://example.com/clip.mp4' } },
    ]);
  });
});

describe('LobeMinimaxAI message pipeline', () => {
  it('keeps reasoning-only assistant turns in the outbound request', async () => {
    const instance = new LobeMinimaxAI({ apiKey: 'test-key' });
    const createSpy = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue((async function* () {})() as any);

    const response = await instance.chat({
      messages: [
        { content: 'first question', role: 'user' },
        { content: '', reasoning: { content: 'thinking about it' }, role: 'assistant' },
        { content: 'second question', role: 'user' },
      ],
      model: 'MiniMax-M2.5',
      stream: true,
    } as any);
    // The SDK call is deferred until the response body is pulled.
    await new Response(response.body).text();

    const requestMessages = createSpy.mock.calls[0][0].messages as any[];
    // The assistant turn carries semantics (MiniMax `reasoning_details` after
    // handlePayload) and must not be dropped by empty-message filtering.
    expect(requestMessages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(requestMessages[1].reasoning_details).toEqual([
      {
        format: 'MiniMax-response-v1',
        id: 'reasoning-text-0',
        index: 0,
        text: 'thinking about it',
        type: 'reasoning.text',
      },
    ]);
  });

  it('does not send OpenAI image detail auto on the Chat Completions body', async () => {
    const instance = new LobeMinimaxAI({ apiKey: 'test-key' });
    const createSpy = vi
      .spyOn((instance as any).client.chat.completions, 'create')
      .mockResolvedValue((async function* () {})() as any);

    const response = await instance.chat({
      messages: [
        {
          content: [
            { text: 'describe', type: 'text' },
            {
              image_url: { detail: 'auto', url: 'data:image/png;base64,abc' },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
      ],
      model: 'MiniMax-M3',
      stream: true,
    } as any);
    await new Response(response.body).text();

    const requestMessages = createSpy.mock.calls[0][0].messages as any[];
    expect(requestMessages[0].content).toEqual([
      { text: 'describe', type: 'text' },
      { image_url: { url: 'data:image/png;base64,abc' }, type: 'image_url' },
    ]);
  });
});

describe('LobeMinimaxAI debug', () => {
  it('logs structured request summary with DEBUG_MINIMAX_CHAT_COMPLETION', async () => {
    const instance = new LobeMinimaxAI({ apiKey: 'test-key' });
    const chatChunk = {
      choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
      id: 'chatcmpl-minimax-debug',
    };
    const mockStream = (async function* () {
      yield chatChunk;
    })();
    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue(mockStream);
    vi.stubEnv('DEBUG_MINIMAX_CHAT_COMPLETION', '1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        max_tokens: 256,
        model: 'MiniMax-M2.5',
        reasoning_split: false,
        stream: true,
      } as any);
      await response.text();

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
        model: 'MiniMax-M2.5',
        params: {
          hasMaxTokens: true,
        },
        provider: 'minimax',
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
