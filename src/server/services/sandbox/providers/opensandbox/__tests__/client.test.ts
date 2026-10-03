/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { parseEventStream } from '../client';

const chunked = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
};

const collect = async (response: Response) => {
  const events = [];
  for await (const event of parseEventStream(response)) events.push(event);
  return events;
};

describe('parseEventStream', () => {
  it('reads blank-line separated JSON objects split across chunks', async () => {
    const events = await collect(
      chunked(['{"type":"stdout","te', 'xt":"a\\n"}\n\n{"type":"ping"}\n', '\n{"type":"result"}']),
    );

    expect(events).toEqual([{ text: 'a\n', type: 'stdout' }, { type: 'ping' }, { type: 'result' }]);
  });

  it('accepts SSE data framing and skips comments and malformed lines', async () => {
    const events = await collect(
      chunked([': keepalive\nevent: message\ndata: {"type":"stderr","text":"x"}\n\nnot json\n']),
    );

    expect(events).toEqual([{ text: 'x', type: 'stderr' }]);
  });
});
