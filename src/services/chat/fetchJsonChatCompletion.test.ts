import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJsonChatCompletion } from './fetchJsonChatCompletion';

describe('fetchJsonChatCompletion', () => {
  const sseFallback = vi.fn();
  const onFinish = vi.fn();
  const onErrorHandle = vi.fn();
  const onAbort = vi.fn();
  const onMessageHandle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses application/json without calling the SSE fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from MiniMax', role: 'assistant' } }],
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );

    await fetchJsonChatCompletion({
      fetcher,
      headers: { Authorization: 'Bearer x' },
      onErrorHandle,
      onFinish,
      onMessageHandle,
      payload: { responseMode: 'json', stream: false },
      sseFallback,
      url: '/webapi/chat/minimax',
    });

    expect(fetcher).toHaveBeenCalledWith(
      '/webapi/chat/minimax',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
        method: 'POST',
      }),
    );
    expect(sseFallback).not.toHaveBeenCalled();
    expect(onMessageHandle).toHaveBeenCalledWith({
      text: 'Hello from MiniMax',
      type: 'text',
    });
    expect(onFinish).toHaveBeenCalledWith(
      'Hello from MiniMax',
      expect.objectContaining({ type: 'done' }),
    );
    expect(onErrorHandle).not.toHaveBeenCalled();
  });

  it('falls back to SSE when the runtime still returns text/event-stream', async () => {
    const streamResponse = new Response('event: text\ndata: hi\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    });
    const fetcher = vi.fn().mockResolvedValue(streamResponse);
    sseFallback.mockResolvedValue(streamResponse);

    await fetchJsonChatCompletion({
      fetcher,
      headers: {},
      payload: { responseMode: 'json' },
      sseFallback,
      url: '/webapi/chat/anthropic',
    });

    expect(sseFallback).toHaveBeenCalledWith(streamResponse);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('surfaces WebKit Load failed as a structured error instead of an empty abort', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Load failed'));

    await fetchJsonChatCompletion({
      fetcher,
      headers: {},
      onAbort,
      onErrorHandle,
      onFinish,
      payload: {},
      sseFallback,
      url: '/webapi/chat/minimax',
    });

    expect(onAbort).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onErrorHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          errorKind: 'webkit_load_failed',
          reason: 'json_chat_fetch_failed',
        }),
        type: 'ConnectionCheckFailed',
      }),
    );
  });

  it('calls onAbort when the request is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const fetcher = vi.fn().mockRejectedValue(abortError);

    await fetchJsonChatCompletion({
      fetcher,
      headers: {},
      onAbort,
      onErrorHandle,
      payload: {},
      signal: controller.signal,
      sseFallback,
      url: '/webapi/chat/minimax',
    });

    expect(onAbort).toHaveBeenCalledWith('');
    expect(onErrorHandle).not.toHaveBeenCalled();
  });
});
