import { describe, expect, it, vi } from 'vitest';

import { fetchEventSource } from './index';

describe('fetchEventSource onRawChunk', () => {
  it('delivers raw bytes before parse, and still surfaces body-reader Load failed', async () => {
    const encoder = new TextEncoder();
    const frame = encoder.encode(`event: text\ndata: ${JSON.stringify('hello')}\n\n`);
    const chunks: Uint8Array[] = [];
    const messages: Array<{ data: string; event: string }> = [];

    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(frame);
          return;
        }
        throw new TypeError('Load failed');
      },
    });

    const response = new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    });
    // Tee before the reader locks the body (matches fetchSSE onopen clone timing).
    const teedClone = response.clone();

    const onerror = vi.fn();

    await fetchEventSource('/sse', {
      fetch: async () => response,
      onRawChunk: (chunk) => {
        chunks.push(chunk.slice());
      },
      onerror,
      onmessage: (ev) => {
        messages.push({ data: ev.data, event: ev.event });
      },
      onopen: async () => undefined,
    });

    expect(new TextDecoder().decode(chunks[0]!)).toContain('hello');
    expect(messages).toEqual([{ data: JSON.stringify('hello'), event: 'text' }]);
    expect(onerror).toHaveBeenCalledWith(expect.objectContaining({ message: 'Load failed' }));

    // After the source errors, the teed clone is not a reliable recovery path
    // (Load failed and/or locked stream depending on the runtime).
    await expect(teedClone.text()).rejects.toThrow();
  });
});
