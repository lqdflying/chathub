import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createChunkDebugTap,
  createDebugStreamTransformer,
  debugRequestPayload,
  debugStream,
} from './debugStream';

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

describe('debugRequestPayload', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  const loggedLines = () => consoleLogSpy.mock.calls.map((call) => String(call[0]));

  it('logs one marker line and the whole payload as ONE compact JSON line', () => {
    debugRequestPayload({
      messages: [
        { content: 'line one\nline two', role: 'system' },
        { content: 'hi', role: 'user' },
      ],
      model: 'kimi-k3',
      stream: true,
      tools: [{ function: { name: 'search', parameters: { type: 'object' } }, type: 'function' }],
    });

    const lines = loggedLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[requestPayload\]/);
    // one complete record: model, messages, and tools all in the same line,
    // with multi-line content JSON-escaped instead of spread across lines
    expect(lines[1]).toContain('"model":"kimi-k3"');
    expect(lines[1]).toContain('"content":"line one\\nline two"');
    expect(lines[1]).toContain('"name":"search"');
    expect(lines[1]).not.toContain('\n');
  });

  it('never throws on circular payloads', () => {
    const circular: Record<string, unknown> = { model: 'm' };
    circular.self = circular;

    expect(() => debugRequestPayload(circular)).not.toThrow();
    expect(loggedLines()).toHaveLength(2);
  });
});

describe('createChunkDebugTap', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  const loggedLines = () => consoleLogSpy.mock.calls.map((call) => String(call[0]));

  it('merges delta chunks into ONE consolidated JSON record — no per-chunk lines', () => {
    const tap = createChunkDebugTap();

    tap.onChunk({
      choices: [{ delta: { content: 'Hello ' }, index: 0 }],
      id: 'chatcmpl-1',
      model: 'kimi-k3',
    });
    tap.onChunk({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop', index: 0 }] });
    tap.onChunk({ choices: [], usage: { total_tokens: 42 } });
    tap.onDone();

    const lines = loggedLines();
    // exactly: [stream start], [stream finished], one consolidated record
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\[stream start\]/);
    expect(lines[1]).toBe('[stream finished] total chunks: 3');
    const record = JSON.parse(lines[2]);
    expect(record).toEqual({
      finishReason: 'stop',
      id: 'chatcmpl-1',
      model: 'kimi-k3',
      text: 'Hello world',
      usage: { total_tokens: 42 },
    });
    expect(lines[2]).not.toContain('\n');
  });

  it('merges reasoning and streamed tool calls into the record', () => {
    const tap = createChunkDebugTap();

    tap.onChunk({ choices: [{ delta: { reasoning_content: 'thinking…' }, index: 0 }] });
    tap.onChunk({
      choices: [
        {
          delta: {
            tool_calls: [{ function: { arguments: '{"a"', name: 'search' }, index: 0 }],
          },
          index: 0,
        },
      ],
    });
    tap.onChunk({
      choices: [{ delta: { tool_calls: [{ function: { arguments: ':1}' }, index: 0 }] }, index: 0 }],
    });
    tap.onDone();

    const lines = loggedLines();
    expect(lines).toHaveLength(3);
    const record = JSON.parse(lines[2]);
    expect(record.reasoning).toBe('thinking…');
    expect(record.toolCalls).toEqual([{ arguments: '{"a":1}', index: 0, name: 'search' }]);
  });

  it('merges responses-API output_text deltas into the record', () => {
    const tap = createChunkDebugTap();

    tap.onChunk({ delta: 'answer ', type: 'response.output_text.delta' });
    tap.onChunk({ delta: 'here', type: 'response.output_text.delta' });
    tap.onChunk({
      response: { id: 'resp-1', usage: { total_tokens: 7 } },
      type: 'response.completed',
    });
    tap.onDone();

    const lines = loggedLines();
    expect(lines).toHaveLength(3);
    const record = JSON.parse(lines[2]);
    expect(record.text).toBe('answer here');
    expect(record.id).toBe('resp-1');
    expect(record.usage).toEqual({ total_tokens: 7 });
  });

  it('logs unknown chunk shapes individually and omits an empty record', () => {
    const tap = createChunkDebugTap();

    tap.onChunk('raw sse line');
    tap.onDone();

    const lines = loggedLines();
    expect(lines).toEqual([
      expect.stringMatching(/^\[stream start\]/),
      '"raw sse line"',
      '[stream finished] total chunks: 1',
    ]);
  });
});
