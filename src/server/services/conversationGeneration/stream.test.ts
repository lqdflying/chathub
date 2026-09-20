/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import {
  consumeProtocolResponse,
  isEmptyCompletionAtContextCeiling,
  isIncompleteLengthStop,
  mergeAssistantGenerationMetadata,
} from './stream';

const sseResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream);
};

describe('consumeProtocolResponse', () => {
  it('accumulates text, reasoning, and usage events', async () => {
    const onText = vi.fn();
    const onReasoning = vi.fn();
    const result = await consumeProtocolResponse(
      sseResponse([
        'event: text\ndata: "Hello"\n\n',
        'event: text\ndata: " world"\n\n',
        'event: reasoning\ndata: "think"\n\n',
        'event: usage\ndata: {"totalInputTokens":3}\n\n',
      ]),
      { onReasoning, onText },
    );

    expect(result.content).toBe('Hello world');
    expect(result.reasoning).toEqual({ content: 'think' });
    expect(result.usage).toEqual({ totalInputTokens: 3 });
    expect(result.performance).toBeUndefined();
    expect(onText).toHaveBeenCalledTimes(2);
    expect(onReasoning).toHaveBeenCalledTimes(1);
  });

  it('accumulates speed after usage as performance', async () => {
    const result = await consumeProtocolResponse(
      sseResponse([
        'event: text\ndata: "Hello"\n\n',
        'event: usage\ndata: {"totalOutputTokens":4,"totalTokens":7}\n\n',
        'event: speed\ndata: {"duration":1200,"latency":1800,"tps":3.3,"ttft":600}\n\n',
      ]),
    );

    expect(result.usage).toEqual({ totalOutputTokens: 4, totalTokens: 7 });
    expect(result.performance).toEqual({
      duration: 1200,
      latency: 1800,
      tps: 3.3,
      ttft: 600,
    });
  });

  it('captures stream errors without throwing', async () => {
    const result = await consumeProtocolResponse(
      sseResponse([
        'event: text\ndata: "partial"\n\n',
        'event: error\ndata: {"message":"upstream failed","type":"ProviderError"}\n\n',
      ]),
    );

    expect(result.content).toBe('partial');
    expect(result.error).toEqual({
      body: { message: 'upstream failed', type: 'ProviderError' },
      message: 'upstream failed',
      type: 'ProviderError',
    });
  });

  it('flushes a complete final protocol block without a trailing blank line', async () => {
    const onText = vi.fn();
    const result = await consumeProtocolResponse(
      sseResponse(['event: text\ndata: "final chunk"']),
      { onText },
    );

    expect(result.content).toBe('final chunk');
    expect(onText).toHaveBeenCalledWith('final chunk', 'final chunk');
  });

  it('does not consume an unterminated frame after abort', async () => {
    const onText = vi.fn();
    const abort = new AbortController();
    const result = await consumeProtocolResponse(
      sseResponse(['event: text\ndata: "hello"\n\nevent: text\ndata: "ignored']),
      {
        onText: async (delta, content) => {
          onText(delta, content);
          abort.abort();
        },
        signal: abort.signal,
      },
    );

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith('hello', 'hello');
    expect(result.content).toBe('hello');
  });

  it.each(['length', 'max_tokens', 'MAX_TOKENS'])(
    'retains token-limit stop reason %s',
    async (reason) => {
      const result = await consumeProtocolResponse(
        sseResponse([
          'event: text\ndata: "partial summary cut mid-sentence"\n\n',
          `event: stop\ndata: ${JSON.stringify(reason)}\n\n`,
        ]),
      );

      expect(result.content).toBe('partial summary cut mid-sentence');
      expect(result.stopReason).toBe(reason);
      expect(isIncompleteLengthStop(result.stopReason)).toBe(true);
    },
  );

  it.each(['stop', 'end_turn', 'completed', 'message_stop'])(
    'does not treat %s as a token-limit stop',
    async (reason) => {
      const result = await consumeProtocolResponse(
        sseResponse([
          'event: text\ndata: "complete summary"\n\n',
          `event: stop\ndata: ${JSON.stringify(reason)}\n\n`,
        ]),
      );

      expect(result.content).toBe('complete summary');
      expect(result.stopReason).toBe(reason);
      expect(isIncompleteLengthStop(result.stopReason)).toBe(false);
    },
  );
});

describe('mergeAssistantGenerationMetadata', () => {
  it('keeps usage flat and merges stream performance', () => {
    expect(
      mergeAssistantGenerationMetadata(
        { totalTokens: 10 },
        { duration: 1000, latency: 1500, tps: 4, ttft: 500 },
        9999,
      ),
    ).toEqual({
      duration: 1000,
      latency: 1500,
      totalTokens: 10,
      tps: 4,
      ttft: 500,
    });
  });

  it('falls back to measured latency when speed never arrived', () => {
    expect(mergeAssistantGenerationMetadata({ totalTokens: 10 }, undefined, 40100)).toEqual({
      latency: 40100,
      totalTokens: 10,
    });
  });
});

describe('isEmptyCompletionAtContextCeiling', () => {
  it('detects a 1M-window prompt with zero output and no text', () => {
    expect(
      isEmptyCompletionAtContextCeiling({
        content: '',
        contextWindowTokens: 1_048_576,
        usage: { totalInputTokens: 1_048_570, totalOutputTokens: 0 },
      }),
    ).toBe(true);
  });

  it('ignores empty replies that still billed output or included tools', () => {
    expect(
      isEmptyCompletionAtContextCeiling({
        content: '',
        contextWindowTokens: 1_048_576,
        usage: { totalInputTokens: 1_048_570, totalOutputTokens: 12 },
      }),
    ).toBe(false);
    expect(
      isEmptyCompletionAtContextCeiling({
        content: '',
        contextWindowTokens: 1_048_576,
        toolCalls: [{ id: 'call-1' }],
        usage: { totalInputTokens: 1_048_570, totalOutputTokens: 0 },
      }),
    ).toBe(false);
  });
});
