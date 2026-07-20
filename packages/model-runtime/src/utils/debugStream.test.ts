import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebugStreamTransformer, debugStream } from './debugStream';

describe('debugStream', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should log stream start and end messages', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue('test chunk');
        controller.close();
      },
    });

    await debugStream(stream);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[stream start\]/));
  });

  it('should handle and log stream errors', async () => {
    let pullCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue('test chunk');
          return;
        }

        controller.error(new Error('stream failed'));
      },
    });

    await debugStream(stream);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[debugStream error]', expect.any(Error));
    expect(consoleErrorSpy).toHaveBeenCalledWith('[error chunk value:]', 'test chunk');
  });

  it('should decode ArrayBuffer chunk values', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('test chunk'));
        controller.close();
      },
    });

    await debugStream(stream);

    expect(consoleLogSpy).toHaveBeenCalledWith('test chunk');
  });

  it('should stringify non-string chunk values', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ test: 'chunk' });
        controller.close();
      },
    });

    await debugStream(stream);

    expect(consoleLogSpy).toHaveBeenCalledWith('{"test":"chunk"}');
  });

  it('should forward circular and BigInt chunks when formatting fails', async () => {
    const circularChunk: Record<string, unknown> = { value: 1n };
    circularChunk.self = circularChunk;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(circularChunk);
        controller.close();
      },
    }).pipeThrough(createDebugStreamTransformer());
    const reader = stream.getReader();

    const firstRead = await reader.read();
    const secondRead = await reader.read();

    expect(firstRead).toEqual({ done: false, value: circularChunk });
    expect(secondRead).toEqual({ done: true, value: undefined });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[unformattable chunk:'));
  });

  it('should forward chunks when console logging throws', async () => {
    consoleLogSpy.mockImplementation(() => {
      throw new Error('console unavailable');
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ content: 'provider chunk' });
        controller.close();
      },
    }).pipeThrough(createDebugStreamTransformer());
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { content: 'provider chunk' },
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });
});
