import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { ChatMessageError } from '@lobechat/types';
import { FetchEventSourceInit } from '@lobechat/utils/client/fetchEventSource/index';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { sleep } from '@lobechat/utils/sleep';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractAssistantTextFromSse, fetchSSE, looksLikeSse } from '../fetchSSE';

// 模拟 i18next
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

vi.mock('@lobechat/utils/client/fetchEventSource/index', () => ({
  fetchEventSource: vi.fn(),
}));

// 在每次测试后清理所有模拟
afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractAssistantTextFromSse', () => {
  it('concatenates event:text JSON string frames', () => {
    const raw = [
      `event: text\ndata: ${JSON.stringify('Hello')}\n\n`,
      `event: usage\ndata: ${JSON.stringify({ totalTokens: 1 })}\n\n`,
      `event: text\ndata: ${JSON.stringify('!')}\n\n`,
    ].join('');

    expect(extractAssistantTextFromSse(raw)).toBe('Hello!');
  });

  it('returns empty for non-SSE bodies and tool-only SSE', () => {
    expect(extractAssistantTextFromSse('plain hello')).toBe('');
    expect(looksLikeSse('plain hello')).toBe(false);
    const toolOnly = `event: tool_calls\ndata: ${JSON.stringify([{ id: '1' }])}\n\n`;
    expect(looksLikeSse(toolOnly)).toBe(true);
    expect(extractAssistantTextFromSse(toolOnly)).toBe('');
  });
});

describe('fetchSSE', () => {
  it('should handle text event correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'fadeIn',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, { text: 'Hello World', type: 'text' });
    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('ignores comment-only heartbeat callbacks', async () => {
    const mockOnErrorHandle = vi.fn();
    const mockOnMessageHandle = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (_url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ data: '', event: '' } as any);
        options.onmessage!({ data: JSON.stringify('Hello'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onErrorHandle: mockOnErrorHandle,
      onMessageHandle: mockOnMessageHandle,
      responseAnimation: 'none',
    });

    expect(mockOnErrorHandle).not.toHaveBeenCalled();
    expect(mockOnMessageHandle).toHaveBeenCalledOnce();
    expect(mockOnMessageHandle).toHaveBeenCalledWith({ text: 'Hello', type: 'text' });
  });

  it('delivers context snapshots through the dedicated callback', async () => {
    const mockOnContextSnapshot = vi.fn();
    const mockOnMessageHandle = vi.fn();
    const snapshot = {
      captureId: 'capture-1',
      continuationReason: 'initial',
      purpose: 'assistant',
      redactions: [],
      requestId: 'request-1',
      sequence: 0,
      status: 'complete',
    };

    (fetchEventSource as any).mockImplementationOnce(
      (_url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify(snapshot),
          event: 'context_snapshot',
        } as any);
      },
    );

    await fetchSSE('/', {
      onContextSnapshot: mockOnContextSnapshot,
      onMessageHandle: mockOnMessageHandle,
      responseAnimation: 'none',
    });

    expect(mockOnContextSnapshot).toHaveBeenCalledWith(snapshot);
    expect(mockOnMessageHandle).not.toHaveBeenCalled();
  });

  it('should handle tool_calls event correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 0, id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
          ]),
        } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 1, id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
          ]),
        } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'fadeIn',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
      tool_calls: [{ id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } }],
      type: 'tool_calls',
    });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, {
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      type: 'tool_calls',
    });
    expect(mockOnFinish).toHaveBeenCalledWith('', {
      observationId: null,
      toolCalls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      traceId: null,
      type: 'done',
    });
  });

  it('should call onMessageHandle with full text if no message event', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        const res = new Response('Hello World', { status: 200, statusText: 'OK' });
        options.onopen!(res as any);
      },
    );

    await fetchSSE('/', { onMessageHandle: mockOnMessageHandle, onFinish: mockOnFinish });

    expect(mockOnMessageHandle).toHaveBeenCalledWith({ text: 'Hello World', type: 'text' });
    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should handle text event with smoothing correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        await sleep(100);
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'smooth',
    });

    const expectedMessages = [
      { text: 'H', type: 'text' },
      { text: 'e', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'o', type: 'text' },
      { text: ' ', type: 'text' },
      { text: 'W', type: 'text' },
      { text: 'o', type: 'text' },
      { text: 'r', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'd', type: 'text' },
    ];

    expectedMessages.forEach((message, index) => {
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(index + 1, message);
    });

    // more assertions for each character...
    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  it('should not handle text events', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('He') } as any);
        await sleep(100);
        options.onmessage!({ event: 'text', data: JSON.stringify('llo') } as any);
        await sleep(60);
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'none',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, { text: 'He', type: 'text' });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, { text: 'llo', type: 'text' });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(3, { text: ' World', type: 'text' });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });

  describe('reasoning', () => {
    it('should handle reasoning event without smoothing', async () => {
      const mockOnMessageHandle = vi.fn();
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({ event: 'reasoning', data: JSON.stringify('Hello') } as any);
          await sleep(400);
          options.onmessage!({ event: 'reasoning', data: JSON.stringify(' World') } as any);
          await sleep(400);
          options.onmessage!({ event: 'text', data: JSON.stringify('hi') } as any);
        },
      );

      await fetchSSE('/', {
        onMessageHandle: mockOnMessageHandle,
        onFinish: mockOnFinish,
        responseAnimation: 'fadeIn',
      });

      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, { text: 'Hello', type: 'reasoning' });
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, { text: ' World', type: 'reasoning' });

      expect(mockOnFinish).toHaveBeenCalledWith('hi', {
        observationId: null,
        toolCalls: undefined,
        reasoning: { content: 'Hello World' },
        traceId: null,
        type: 'done',
      });
    });

    it('should capture reasoning signature in onFinish reasoning', async () => {
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({ event: 'reasoning', data: JSON.stringify('Let me think') } as any);
          options.onmessage!({
            event: 'reasoning_signature',
            data: JSON.stringify('sig-abc123'),
          } as any);
          options.onmessage!({ event: 'text', data: JSON.stringify('Answer') } as any);
        },
      );

      await fetchSSE('/', { onFinish: mockOnFinish, responseAnimation: 'none' });

      expect(mockOnFinish).toHaveBeenCalledWith('Answer', {
        observationId: null,
        toolCalls: undefined,
        reasoning: { content: 'Let me think', signature: 'sig-abc123' },
        traceId: null,
        type: 'done',
      });
    });

    it('should separate redacted (flagged) signatures from regular signatures', async () => {
      const mockOnFinish = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
          options.onmessage!({
            event: 'flagged_reasoning_signature',
            data: JSON.stringify('redacted-data-1'),
          } as any);
          options.onmessage!({
            event: 'flagged_reasoning_signature',
            data: JSON.stringify('redacted-data-2'),
          } as any);
          options.onmessage!({ event: 'text', data: JSON.stringify('Response') } as any);
        },
      );

      await fetchSSE('/', { onFinish: mockOnFinish, responseAnimation: 'none' });

      expect(mockOnFinish).toHaveBeenCalledWith('Response', {
        observationId: null,
        toolCalls: undefined,
        reasoning: { redactedSignatures: ['redacted-data-1', 'redacted-data-2'] },
        traceId: null,
        type: 'done',
      });
    });
  });

  it('should handle grounding event', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'grounding', data: JSON.stringify('Hello') } as any);
        await sleep(100);
        options.onmessage!({ event: 'text', data: JSON.stringify('hi') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
      grounding: 'Hello',
      type: 'grounding',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('hi', {
      observationId: null,
      toolCalls: undefined,
      grounding: 'Hello',
      traceId: null,
      type: 'done',
    });
  });

  it('should handle tool_calls event correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 0, id: '1', type: 'function', function: { name: 'func1', arguments: 'a' } },
          ]),
        } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([
            { index: 0, function: { arguments: 'rg1' } },
            { index: 1, id: '2', type: 'function', function: { name: 'func2', arguments: 'a' } },
          ]),
        } as any);
        options.onmessage!({
          event: 'tool_calls',
          data: JSON.stringify([{ index: 1, function: { arguments: 'rg2' } }]),
        } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      responseAnimation: 'smooth',
    });

    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(1, {
      tool_calls: [{ id: '1', type: 'function', function: { name: 'func1', arguments: 'a' } }],
      type: 'tool_calls',
    });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(2, {
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'a' } },
      ],
      type: 'tool_calls',
    });
    expect(mockOnMessageHandle).toHaveBeenNthCalledWith(3, {
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      type: 'tool_calls',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('', {
      observationId: null,
      toolCalls: [
        { id: '1', type: 'function', function: { name: 'func1', arguments: 'arg1' } },
        { id: '2', type: 'function', function: { name: 'func2', arguments: 'arg2' } },
      ],
      traceId: null,
      type: 'done',
    });
  });

  it('should handle request interruption and resumption correctly', async () => {
    const mockOnMessageHandle = vi.fn();
    const mockOnFinish = vi.fn();
    const abortController = new AbortController();

    (fetchEventSource as any).mockImplementationOnce(
      async (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        await sleep(100);
        abortController.abort();
        options.onmessage!({ event: 'text', data: JSON.stringify(' World') } as any);
      },
    );

    await fetchSSE('/', {
      onMessageHandle: mockOnMessageHandle,
      onFinish: mockOnFinish,
      signal: abortController.signal,
      responseAnimation: 'smooth',
    });

    const expectedMessages = [
      { text: 'H', type: 'text' },
      { text: 'e', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'o', type: 'text' },
      { text: ' ', type: 'text' },
      { text: 'W', type: 'text' },
      { text: 'o', type: 'text' },
      { text: 'r', type: 'text' },
      { text: 'l', type: 'text' },
      { text: 'd', type: 'text' },
    ];

    expectedMessages.forEach((message, index) => {
      expect(mockOnMessageHandle).toHaveBeenNthCalledWith(index + 1, message);
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello World', {
      type: 'done',
      observationId: null,
      traceId: null,
    });
  });

  it('should call onFinish with correct parameters for different finish types', async () => {
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        options.onerror!({ name: 'AbortError' });
      },
    );

    await fetchSSE('/', { onFinish: mockOnFinish, responseAnimation: 'fadeIn' });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'abort',
    });

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
        options.onerror!(new Error('Unknown error'));
      },
    );

    await fetchSSE('/', { onFinish: mockOnFinish, responseAnimation: 'fadeIn' });

    expect(mockOnFinish).toHaveBeenCalledWith('Hello', {
      observationId: null,
      toolCalls: undefined,
      traceId: null,
      type: 'error',
    });
  });

  describe('onAbort', () => {
    it('should call onAbort when AbortError is thrown', async () => {
      const mockOnAbort = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
          options.onerror!({ name: 'AbortError' });
        },
      );

      await fetchSSE('/', { onAbort: mockOnAbort, responseAnimation: 'fadeIn' });

      expect(mockOnAbort).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ errorKind: 'abort' }),
      );
    });

    it('should call onAbort when MESSAGE_CANCEL_FLAT is thrown', async () => {
      const mockOnAbort = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
          options.onerror!(MESSAGE_CANCEL_FLAT);
        },
      );

      await fetchSSE('/', { onAbort: mockOnAbort, responseAnimation: 'fadeIn' });

      expect(mockOnAbort).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ errorKind: 'abort' }),
      );
    });

    it('should call onAbort when Safari Load failed is thrown', async () => {
      const mockOnAbort = vi.fn();
      const mockOnErrorHandle = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
          options.onerror!(new TypeError('Load failed'));
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onErrorHandle: mockOnErrorHandle,
        responseAnimation: 'fadeIn',
      });

      expect(mockOnAbort).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ errorClass: 'TypeError', errorKind: 'webkit_load_failed' }),
      );
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });

    it('delivers reasoning before onAbort when Load failed follows reasoning under text:none', async () => {
      const order: string[] = [];
      const mockOnAbort = vi.fn(async () => {
        order.push('abort');
      });
      const mockOnMessageHandle = vi.fn((chunk: { type?: string }) => {
        if (chunk.type === 'reasoning') order.push('reasoning');
      });

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'reasoning', data: JSON.stringify('think') } as any);
          options.onerror!(new TypeError('Load failed'));
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onMessageHandle: mockOnMessageHandle,
        responseAnimation: 'none',
      });

      expect(order).toEqual(['reasoning', 'abort']);
      expect(mockOnAbort).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          errorKind: 'webkit_load_failed',
          reasoning: 'think',
        }),
      );
    });

    it('flushes buffered reasoning before onAbort on WebKit Load failed (fadeIn)', async () => {
      const order: string[] = [];
      const mockOnAbort = vi.fn(async () => {
        order.push('abort');
      });
      const mockOnMessageHandle = vi.fn((chunk: { type?: string }) => {
        if (chunk.type === 'reasoning') order.push('reasoning');
      });

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'reasoning', data: JSON.stringify('trace') } as any);
          // Abort before the 300ms coalesce timer would fire.
          options.onerror!(new TypeError('Load failed'));
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onMessageHandle: mockOnMessageHandle,
        responseAnimation: 'fadeIn',
      });

      expect(order).toEqual(['reasoning', 'abort']);
      expect(mockOnAbort).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          errorKind: 'webkit_load_failed',
          reasoning: 'trace',
        }),
      );
    });

    it('should call only onAbort when Safari Load failed leaves empty output', async () => {
      const mockOnAbort = vi.fn();
      const mockOnErrorHandle = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(new TypeError('Load failed'));
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onErrorHandle: mockOnErrorHandle,
        responseAnimation: 'none',
      });

      expect(mockOnAbort).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ errorKind: 'webkit_load_failed' }),
      );
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });

    it('recovers assistant text from onRawChunk after empty WebKit Load failed', async () => {
      // Models real topology: bytes arrive before body-reader error; clone().text
      // would reject on the shared tee, so recovery must use captured chunks.
      const mockOnAbort = vi.fn();
      const mockOnFinish = vi.fn();
      const mockOnErrorHandle = vi.fn();
      const mockOnMessageHandle = vi.fn();
      const hello = 'Hello! How can I help you today?';
      const sseBody = `event: text\ndata: ${JSON.stringify(hello)}\n\n`;

      const makeErroredCloneResponse = (): any => ({
        clone: () => makeErroredCloneResponse(),
        headers: new Headers(),
        ok: true,
        text: async () => {
          throw new TypeError('Load failed');
        },
      });

      (fetchEventSource as any).mockImplementationOnce(
        async (_url: string, options: FetchEventSourceInit) => {
          await options.onopen!(makeErroredCloneResponse());
          options.onRawChunk?.(new TextEncoder().encode(sseBody));
          options.onerror!(new TypeError('Load failed'));
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onErrorHandle: mockOnErrorHandle,
        onFinish: mockOnFinish,
        onMessageHandle: mockOnMessageHandle,
        rawByteCaptureMax: 64 * 1024,
        responseAnimation: 'none',
      });

      expect(mockOnAbort).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ errorKind: 'webkit_load_failed' }),
      );
      expect(mockOnFinish).toHaveBeenCalledWith(
        hello,
        expect.objectContaining({ type: 'abort' }),
      );
      expect(mockOnMessageHandle).toHaveBeenCalledWith({ text: hello, type: 'text' });
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });

    it('does not recover raw SSE as assistant text for tool-only streams', async () => {
      const mockOnFinish = vi.fn();
      const mockOnMessageHandle = vi.fn();
      const toolPayload = [
        { function: { arguments: '{}', name: 'fn' }, id: '1', type: 'function' },
      ];
      const sseBody = `event: tool_calls\ndata: ${JSON.stringify(toolPayload)}\n\n`;

      (fetchEventSource as any).mockImplementationOnce(
        async (_url: string, options: FetchEventSourceInit) => {
          await options.onopen!({
            clone: () => ({ headers: new Headers(), ok: true }),
            headers: new Headers(),
            ok: true,
          } as any);
          options.onRawChunk?.(new TextEncoder().encode(sseBody));
          options.onmessage!({
            data: JSON.stringify(toolPayload),
            event: 'tool_calls',
          } as any);
        },
      );

      await fetchSSE('/', {
        onFinish: mockOnFinish,
        onMessageHandle: mockOnMessageHandle,
        rawByteCaptureMax: 64 * 1024,
        responseAnimation: 'none',
      });

      expect(mockOnMessageHandle).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool_calls' }),
      );
      expect(mockOnMessageHandle).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text' }),
      );
      expect(mockOnFinish).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          toolCalls: expect.any(Array),
          type: 'done',
        }),
      );
    });

    it('does not duplicate smooth text via raw capture when tokens remain queued', async () => {
      const texts: string[] = [];
      const mockOnFinish = vi.fn();
      const sseBody = `event: text\ndata: ${JSON.stringify('Hi')}\n\n`;

      (fetchEventSource as any).mockImplementationOnce(
        async (_url: string, options: FetchEventSourceInit) => {
          await options.onopen!({
            clone: () => ({ headers: new Headers(), ok: true }),
            headers: new Headers(),
            ok: true,
          } as any);
          options.onRawChunk?.(new TextEncoder().encode(sseBody));
          options.onmessage!({ data: JSON.stringify('Hi'), event: 'text' } as any);
        },
      );

      await fetchSSE('/', {
        onFinish: mockOnFinish,
        onMessageHandle: (chunk) => {
          if (chunk.type === 'text' && typeof chunk.text === 'string') texts.push(chunk.text);
        },
        rawByteCaptureMax: 64 * 1024,
        responseAnimation: 'smooth',
      });

      // Recovery must not prepend a second full "Hi" before smooth animation.
      expect(texts.join('')).toBe('Hi');
      expect(mockOnFinish).toHaveBeenCalledWith('Hi', expect.objectContaining({ type: 'done' }));
    });

    it('leaves output empty when clone would reject and no raw bytes were captured', async () => {
      const mockOnAbort = vi.fn();
      const mockOnFinish = vi.fn();
      const mockOnErrorHandle = vi.fn();

      const makeErroredCloneResponse = (): any => ({
        clone: () => makeErroredCloneResponse(),
        headers: new Headers(),
        ok: true,
        text: async () => {
          throw new TypeError('Load failed');
        },
      });

      (fetchEventSource as any).mockImplementationOnce(
        async (_url: string, options: FetchEventSourceInit) => {
          await options.onopen!(makeErroredCloneResponse());
          options.onerror!(new TypeError('Load failed'));
        },
      );

      await expect(
        fetchSSE('/', {
          onAbort: mockOnAbort,
          onErrorHandle: mockOnErrorHandle,
          onFinish: mockOnFinish,
          rawByteCaptureMax: 64 * 1024,
          responseAnimation: 'none',
        }),
      ).resolves.toBeTruthy();

      expect(mockOnAbort).toHaveBeenCalled();
      expect(mockOnFinish).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ type: 'abort' }),
      );
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });

    it('should call only onAbort for empty intentional MESSAGE_CANCEL_FLAT', async () => {
      const mockOnAbort = vi.fn();
      const mockOnErrorHandle = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(MESSAGE_CANCEL_FLAT);
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onErrorHandle: mockOnErrorHandle,
        responseAnimation: 'none',
      });

      expect(mockOnAbort).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ errorKind: 'abort' }),
      );
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });

    it('should call only onAbort for empty AbortError', async () => {
      const mockOnAbort = vi.fn();
      const mockOnErrorHandle = vi.fn();
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(abortError);
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onErrorHandle: mockOnErrorHandle,
        responseAnimation: 'none',
      });

      expect(mockOnAbort).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ errorKind: 'abort' }),
      );
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });

    it('should call onAbort when Chromium Failed to fetch is thrown', async () => {
      const mockOnAbort = vi.fn();
      const mockOnErrorHandle = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: JSON.stringify('Hello') } as any);
          options.onerror!(new TypeError('Failed to fetch'));
        },
      );

      await fetchSSE('/', {
        onAbort: mockOnAbort,
        onErrorHandle: mockOnErrorHandle,
        responseAnimation: 'fadeIn',
      });

      expect(mockOnAbort).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ errorClass: 'TypeError', errorKind: 'failed_to_fetch' }),
      );
      expect(mockOnErrorHandle).not.toHaveBeenCalled();
    });
  });

  describe('onErrorHandle', () => {
    it('should call onErrorHandle when Chat Message error is thrown', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError: ChatMessageError = {
        body: {},
        message: 'StreamChunkError',
        type: 'StreamChunkError',
      };

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(mockError);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith(mockError);
    });

    it('should call onErrorHandle when Unknown error is thrown', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError = new Error('Unknown error');

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onerror!(mockError);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith({
        type: 'UnknownChatFetchError',
        message: 'Unknown error',
        body: {
          message: 'Unknown error',
          name: 'Error',
          stack: expect.any(String),
        },
      });
    });

    it('should call onErrorHandle when response is not ok', async () => {
      const mockOnErrorHandle = vi.fn();

      (fetchEventSource as any).mockImplementationOnce(
        async (url: string, options: FetchEventSourceInit) => {
          const res = new Response(JSON.stringify({ errorType: 'SomeError' }), {
            status: 400,
            statusText: 'Error',
          });

          try {
            await options.onopen!(res as any);
          } catch (e) {}
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {
        expect(mockOnErrorHandle).toHaveBeenCalledWith({
          body: undefined,
          message: 'translated_response.SomeError',
          type: 'SomeError',
        });
      }
    });

    it('extracts a context snapshot from a non-ok response before reporting the error', async () => {
      const mockOnContextSnapshot = vi.fn();
      const mockOnErrorHandle = vi.fn();
      const contextExportSnapshot = {
        captureId: 'capture-1',
        continuationReason: 'initial',
        providerRequest: { model: 'test-model' },
        purpose: 'assistant',
        redactions: ['storedIdentifiers'],
        requestId: 'request-1',
        sequence: 0,
        status: 'error',
      };

      (fetchEventSource as any).mockImplementationOnce(
        async (_url: string, options: FetchEventSourceInit) => {
          const response = new Response(
            JSON.stringify({
              body: {
                contextExportSnapshot,
                error: { message: 'provider rejected request' },
                provider: 'test-provider',
              },
              errorType: 'ProviderBizError',
            }),
            { status: 471, statusText: 'Provider Error' },
          );

          try {
            await options.onopen!(response);
          } catch (error) {
            options.onerror!(error);
          }
        },
      );

      await fetchSSE('/', {
        onContextSnapshot: mockOnContextSnapshot,
        onErrorHandle: mockOnErrorHandle,
      });

      expect(mockOnContextSnapshot).toHaveBeenCalledWith(contextExportSnapshot);
      expect(mockOnErrorHandle).toHaveBeenCalledWith({
        body: {
          error: { message: 'provider rejected request' },
          provider: 'test-provider',
        },
        message: 'translated_response.ProviderBizError',
        type: 'ProviderBizError',
      });
    });

    it('should call onErrorHandle when stream chunk has error type', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError = {
        type: 'StreamChunkError',
        message: 'abc',
        body: { message: 'abc', context: {} },
      };

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({
            event: 'error',
            data: JSON.stringify(mockError),
          } as any);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith(mockError);
    });

    it('should call onErrorHandle when stream chunk is not valid json', async () => {
      const mockOnErrorHandle = vi.fn();
      const mockError = 'abc';

      (fetchEventSource as any).mockImplementationOnce(
        (url: string, options: FetchEventSourceInit) => {
          options.onmessage!({ event: 'text', data: mockError } as any);
        },
      );

      try {
        await fetchSSE('/', { onErrorHandle: mockOnErrorHandle });
      } catch (e) {}

      expect(mockOnErrorHandle).toHaveBeenCalledWith({
        body: {
          context: {
            chunk: 'abc',
            error: {
              message: 'Unexpected token \'a\', "abc" is not valid JSON',
              name: 'SyntaxError',
            },
          },
          message:
            'chat response streaming chunk parse error, please contact your API Provider to fix it.',
        },
        message: 'parse error',
        type: 'StreamChunkError',
      });
    });
  });
});
