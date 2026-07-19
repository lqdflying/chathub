import { describe, expect, it, vi } from 'vitest';

import { SSE_HEARTBEAT_COMMENT, StreamingResponse } from './response';

describe('StreamingResponse', () => {
  it('should create Response with default headers', () => {
    const mockStream = new ReadableStream();
    const response = StreamingResponse(mockStream);

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should create Response with custom headers', () => {
    const mockStream = new ReadableStream();
    const customHeaders = {
      'Custom-Header': 'custom-value',
      'Authorization': 'Bearer token',
    };

    const response = StreamingResponse(mockStream, { headers: customHeaders });

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);

    // Default headers should still be present
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    // Custom headers should be added
    expect(response.headers.get('Custom-Header')).toBe('custom-value');
    expect(response.headers.get('Authorization')).toBe('Bearer token');
  });

  it('should allow custom headers to override default headers', () => {
    const mockStream = new ReadableStream();
    const overrideHeaders = {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=3600',
    };

    const response = StreamingResponse(mockStream, { headers: overrideHeaders });

    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('max-age=3600');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should handle empty options object', () => {
    const mockStream = new ReadableStream();
    const response = StreamingResponse(mockStream, {});

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should handle options with empty headers', () => {
    const mockStream = new ReadableStream();
    const response = StreamingResponse(mockStream, { headers: {} });

    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBe(mockStream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('should work with actual ReadableStream data', async () => {
    const testData = 'data: {"test": "value"}\n\n';
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(testData));
        controller.close();
      },
    });

    const response = StreamingResponse(stream);
    const responseText = await response.text();

    expect(responseText).toBe(testData);
  });

  it('emits an immediate comment and idle heartbeat when enabled', async () => {
    vi.useFakeTimers();
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });

    try {
      const response = StreamingResponse(source, { heartbeatIntervalMs: 100 });
      const reader = response.body!.getReader();

      expect(new TextDecoder().decode((await reader.read()).value)).toBe(SSE_HEARTBEAT_COMMENT);

      const nextHeartbeat = reader.read();
      await vi.advanceTimersByTimeAsync(100);
      expect(new TextDecoder().decode((await nextHeartbeat).value)).toBe(SSE_HEARTBEAT_COMMENT);

      sourceController.close();
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not insert a heartbeat into a partial SSE frame', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });

    try {
      const response = StreamingResponse(source, { heartbeatIntervalMs: 100 });
      const reader = response.body!.getReader();
      await reader.read();

      sourceController.enqueue(encoder.encode('id: result\nevent: text\ndata: "hel'));
      const frameRead = reader.read();
      let frameSettled = false;
      void frameRead.then(() => {
        frameSettled = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(frameSettled).toBe(false);

      sourceController.enqueue(encoder.encode('lo"\n\n'));
      expect(decoder.decode((await frameRead).value)).toBe(
        'id: result\nevent: text\ndata: "hello"\n\n',
      );

      sourceController.close();
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      vi.useRealTimers();
    }
  });
});
