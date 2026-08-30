/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { consumeProtocolResponse, isIncompleteLengthStop } from './stream';

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
    expect(onText).toHaveBeenCalledTimes(2);
    expect(onReasoning).toHaveBeenCalledTimes(1);
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
