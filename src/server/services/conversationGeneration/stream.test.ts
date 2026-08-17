/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { consumeProtocolResponse } from './stream';

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
});
