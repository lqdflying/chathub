export const SSE_HEARTBEAT_INTERVAL_MS = 10_000;
export const SSE_HEARTBEAT_COMMENT = ': chathub-ping\n\n';

const createSSEKeepAliveStream = (source: ReadableStream, heartbeatIntervalMs: number) => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let closed = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader;

  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      closed = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      await reader.cancel(reason);
    },
    start(controller) {
      reader = source.getReader();

      const scheduleHeartbeat = () => {
        if (closed) return;
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
          if (closed) return;

          // Never insert a comment into a partially buffered SSE frame.
          if (buffer.length === 0) controller.enqueue(encoder.encode(SSE_HEARTBEAT_COMMENT));
          scheduleHeartbeat();
        }, heartbeatIntervalMs);
        (heartbeatTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      };
      const emitFrame = (frame: string) => {
        controller.enqueue(encoder.encode(frame));
        scheduleHeartbeat();
      };
      const emitCompleteFrames = () => {
        let separator = buffer.match(/\r?\n\r?\n/);

        while (separator?.index !== undefined) {
          const frameEnd = separator.index + separator[0].length;
          emitFrame(buffer.slice(0, frameEnd));
          buffer = buffer.slice(frameEnd);
          separator = buffer.match(/\r?\n\r?\n/);
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        controller.close();
      };

      controller.enqueue(encoder.encode(SSE_HEARTBEAT_COMMENT));
      scheduleHeartbeat();

      void (async () => {
        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) {
              buffer += decoder.decode();
              emitCompleteFrames();
              if (buffer) controller.enqueue(encoder.encode(buffer));
              close();
              return;
            }

            buffer +=
              typeof value === 'string'
                ? value
                : decoder.decode(value, { stream: true });
            emitCompleteFrames();
          }
        } catch (error) {
          if (closed) return;
          closed = true;
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          controller.error(error);
        }
      })();
    },
  });
};

export const StreamingResponse = (
  stream: ReadableStream,
  options?: { headers?: Record<string, string>; heartbeatIntervalMs?: false | number },
) => {
  const responseStream =
    options?.heartbeatIntervalMs && options.heartbeatIntervalMs > 0
      ? createSSEKeepAliveStream(stream, options.heartbeatIntervalMs)
      : stream;

  return new Response(responseStream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream',
      // for Nginx: disable chunk buffering
      'X-Accel-Buffering': 'no',
      ...options?.headers,
    },
  });
};
