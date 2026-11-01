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

describe('OpenSandboxClient.getExecdEndpoint', () => {
  afterEach(() => vi.unstubAllGlobals());

  const endpointResponse = (endpoint: string) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ endpoint, headers: { 'x-a': '1' } })));

  it('uses the returned proxy URL by default, adding the base protocol when missing', async () => {
    vi.stubGlobal('fetch', endpointResponse('10.0.0.5:8090/v1/sandboxes/sbx/proxy/44772'));
    const client = new OpenSandboxClient({ baseUrl: 'https://sandbox.example.com' });
    await expect(client.getExecdEndpoint('sbx', AbortSignal.timeout(1000))).resolves.toEqual({
      headers: { 'x-a': '1' },
      url: 'https://10.0.0.5:8090/v1/sandboxes/sbx/proxy/44772',
    });
  });

  it('rebases the returned path onto the configured URL when asked', async () => {
    vi.stubGlobal('fetch', endpointResponse('http://10.0.0.5:8090/v1/sandboxes/sbx/proxy/44772/'));
    const client = new OpenSandboxClient({
      baseUrl: 'https://sandbox.example.com/',
      rebaseExecdEndpoint: true,
    });
    await expect(client.getExecdEndpoint('sbx', AbortSignal.timeout(1000))).resolves.toMatchObject({
      url: 'https://sandbox.example.com/v1/sandboxes/sbx/proxy/44772',
    });
  });
});

