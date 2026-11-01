/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenSandboxClient, parseEventStream } from '../client';

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

describe('OpenSandboxClient.health', () => {
  afterEach(() => vi.unstubAllGlobals());

  const client = () => new OpenSandboxClient({ apiKey: 'key', baseUrl: 'https://sandbox.example/' });

  it('checks /health and then the API key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"status":"ok"}'))
      .mockResolvedValueOnce(new Response('{"items":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(client().health(AbortSignal.timeout(1000))).resolves.toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sandbox.example/health');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/v1/sandboxes?');
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'OPEN-SANDBOX-API-KEY': 'key' });
  });

  it('reports a rejected key and an unreachable server without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('ok'))
        .mockResolvedValueOnce(new Response('{"message":"bad key"}', { status: 401 })),
    );
    await expect(client().health(AbortSignal.timeout(1000))).resolves.toBe('unauthorized');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(client().health(AbortSignal.timeout(1000))).resolves.toBe('unreachable');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));
    await expect(client().health(AbortSignal.timeout(1000))).resolves.toBe('unreachable');
  });
});
