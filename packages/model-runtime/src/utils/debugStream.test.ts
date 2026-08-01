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

  it('pretty-prints the payload and each message content as raw text', () => {
    debugRequestPayload({
      messages: [
        { content: 'line one\nline two', role: 'system' },
        { content: 'hi', role: 'user' },
      ],
      model: 'kimi-k3',
      stream: true,
    });

    const lines = loggedLines();
    expect(lines[0]).toMatch(/^\[requestPayload\]/);
    // rest of the payload is pretty-printed without the messages
    expect(lines[1]).toContain('"model": "kimi-k3"');
    expect(lines[1]).not.toContain('messages');
    // message content appears as real text, not a JSON-escaped line
    expect(lines).toContain('[message 0] role=system (17 chars)');
    expect(lines).toContain('line one\nline two');
    expect(lines).toContain('[message 1] role=user (2 chars)');
  });

  it('keeps non-content message fields visible as a compact suffix', () => {
    debugRequestPayload({
      messages: [{ content: '', role: 'assistant', tool_calls: [{ id: 'call_1' }] }],
      model: 'm',
    });

    const header = loggedLines().find((line) => line.startsWith('[message 0]'));
    expect(header).toContain('tool_calls');
    expect(header).toContain('call_1');
  });

  it('prints an anthropic-style top-level system prompt as its own section', () => {
    debugRequestPayload({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'claude',
      system: 'be helpful',
    });

    const lines = loggedLines();
    expect(lines).toContain('[system] (10 chars)');
    expect(lines).toContain('be helpful');
  });

  it('prints responses-API input items like messages', () => {
    debugRequestPayload({
      input: [{ content: 'question', role: 'user' }],
      model: 'o3',
    });

    expect(loggedLines()).toContain('[message 0] role=user (8 chars)');
  });

  it('never throws on circular payloads', () => {
    const circular: Record<string, unknown> = { model: 'm' };
    circular.self = circular;

    expect(() => debugRequestPayload(circular)).not.toThrow();
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

  it('marks stream start/chunks and assembles text and usage at the end', () => {
    const tap = createChunkDebugTap();

    tap.onChunk({ choices: [{ delta: { content: 'Hello ' }, index: 0 }] });
    tap.onChunk({ choices: [{ delta: { content: 'world' }, index: 0 }] });
    tap.onChunk({ choices: [], usage: { total_tokens: 42 } });
    tap.onDone();

    const lines = loggedLines();
    expect(lines[0]).toMatch(/^\[stream start\]/);
    expect(lines.filter((line) => line.startsWith('[chunk '))).toHaveLength(3);
    expect(lines).toContain('[stream finished] total chunks: 3');
    expect(lines).toContain('[assembled text]');
    expect(lines).toContain('Hello world');
    expect(lines.some((line) => line.startsWith('[usage]') && line.includes('42'))).toBe(true);
  });

  it('assembles reasoning and streamed tool calls', () => {
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
    expect(lines).toContain('[assembled reasoning]');
    expect(lines).toContain('thinking…');
    expect(lines).toContain('[tool call 0] search {"a":1}');
  });

  it('assembles responses-API output_text deltas', () => {
    const tap = createChunkDebugTap();

    tap.onChunk({ delta: 'answer ', type: 'response.output_text.delta' });
    tap.onChunk({ delta: 'here', type: 'response.output_text.delta' });
    tap.onChunk({ response: { usage: { total_tokens: 7 } }, type: 'response.completed' });
    tap.onDone();

    const lines = loggedLines();
    expect(lines).toContain('[assembled text]');
    expect(lines).toContain('answer here');
    expect(lines.some((line) => line.startsWith('[usage]') && line.includes('7'))).toBe(true);
  });

  it('still logs chunks of unknown shape without a summary', () => {
    const tap = createChunkDebugTap();

    tap.onChunk('raw sse line');
    tap.onDone();

    const lines = loggedLines();
    expect(lines).toContain('"raw sse line"');
    expect(lines).toContain('[stream finished] total chunks: 1');
    expect(lines).not.toContain('[assembled text]');
  });
});
