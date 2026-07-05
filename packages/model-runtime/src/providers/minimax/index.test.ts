// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import { LobeMinimaxAI, buildMinimaxOpenAIChatPayload } from './index';

describe('buildMinimaxOpenAIChatPayload', () => {
  it('defaults reasoning_split to true when payload omits it', () => {
    const out = buildMinimaxOpenAIChatPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'MiniMax-M2.7',
    } as any);
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
});

describe('LobeMinimaxAI debug', () => {
  it('logs structured request summary with DEBUG_MINIMAX_CHAT_COMPLETION', async () => {
    const instance = new LobeMinimaxAI({ apiKey: 'test-key' });
    const mockProdStream = new ReadableStream() as any;
    const mockDebugStream = new ReadableStream() as any;
    mockDebugStream.toReadableStream = () => mockDebugStream;

    vi.spyOn((instance as any).client.chat.completions, 'create').mockResolvedValue({
      tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
    });
    vi.stubEnv('DEBUG_MINIMAX_CHAT_COMPLETION', '1');
    const debugStreamSpy = vi
      .spyOn(debugStreamModule, 'debugStream')
      .mockImplementation(() => Promise.resolve());
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        max_tokens: 256,
        model: 'MiniMax-M2.5',
        reasoning_split: false,
        stream: true,
      } as any);

      expect(debugStreamModule.debugStream).toHaveBeenCalled();
      const providerDebugCall = logSpy.mock.calls.find(
        ([label]) => label === '[provider-debug:request]',
      );
      expect(providerDebugCall).toBeDefined();
      expect(JSON.parse(providerDebugCall?.[1] as string)).toMatchObject({
        effectiveURL: 'https://api.minimax.io/v1/chat/completions',
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
      debugStreamSpy.mockRestore();
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
