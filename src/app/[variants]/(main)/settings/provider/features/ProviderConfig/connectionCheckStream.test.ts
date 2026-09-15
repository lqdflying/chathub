import { fetchSSE } from '@lobechat/fetch-sse';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIStream } from '../../../../../../../../packages/model-runtime/src/core/streams/openai/openai';
import { OpenAIResponsesStream } from '../../../../../../../../packages/model-runtime/src/core/streams/openai/responsesStream';
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  StreamingResponse,
} from '../../../../../../../../packages/model-runtime/src/utils/response';

import { hasSuccessfulConnectionCheck } from './connectionCheckParams';

async function* chunks(values: unknown[]) {
  yield* values;
}

const sseResponse = (body: BodyInit) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream' } });

const inspectCompatibleCheck = async (response: Response) => {
  const onError = vi.fn();
  let result: {
    finishType?: string;
    pass: boolean;
    streamCompleted?: boolean;
    text: string;
  } = { pass: false, text: '' };

  await fetchSSE('/synthetic-provider-check', {
    fetcher: async () => response,
    onErrorHandle: onError,
    onFinish: async (text, context) => {
      result = {
        finishType: context.type,
        pass:
          onError.mock.calls.length === 0 &&
          hasSuccessfulConnectionCheck(
            'openaicompatible',
            text,
            context.reasoning,
            false,
            context.streamCompleted,
          ),
        streamCompleted: context.streamCompleted,
        text,
      };
    },
    rawByteCaptureMax: 64 * 1024,
    responseAnimation: { text: 'none' },
  });

  return { ...result, errorCount: onError.mock.calls.length };
};

describe('OpenAI-compatible Connectivity Check stream terminals', () => {
  it('rejects an empty HTTP 200 SSE body without a stop event', async () => {
    const result = await inspectCompatibleCheck(
      sseResponse(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      ),
    );

    expect(result.text).toBe('');
    expect(result.errorCount).toBe(0);
    expect(result.finishType).toBe('done');
    expect(result.streamCompleted).toBeUndefined();
    expect(result.pass).toBe(false);
  });

  it('rejects Chat Completions role-only output followed by EOF', async () => {
    const stream = OpenAIStream(
      chunks([
        {
          id: 'probe',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        },
      ]) as any,
      { enableStreaming: true },
    );
    const wire = await new Response(stream).text();

    expect(wire).not.toContain('event: stop');

    const result = await inspectCompatibleCheck(sseResponse(wire));

    expect(result.text).toBe('');
    expect(result.streamCompleted).toBeUndefined();
    expect(result.pass).toBe(false);
  });

  it('accepts explicitly completed empty Chat Completions output', async () => {
    const stream = OpenAIStream(
      chunks([
        {
          id: 'probe',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ]) as any,
      { enableStreaming: true },
    );
    const result = await inspectCompatibleCheck(sseResponse(await new Response(stream).text()));

    expect(result.streamCompleted).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('accepts completed empty Responses output including usage', async () => {
    const stream = OpenAIResponsesStream(
      chunks([
        {
          type: 'response.completed',
          response: {
            id: 'probe',
            status: 'completed',
            usage: { input_tokens: 7, output_tokens: 0, total_tokens: 7 },
          },
        },
      ]) as any,
      { enableStreaming: true },
      { requireTerminalEvent: true },
    );
    const result = await inspectCompatibleCheck(sseResponse(await new Response(stream).text()));

    expect(result.streamCompleted).toBe(true);
    expect(result.pass).toBe(true);
  });

  it.each(['response.incomplete', 'response.failed'])('rejects normalized %s', async (type) => {
    const stream = OpenAIResponsesStream(
      chunks([
        {
          type,
          response: {
            id: 'probe',
            status: type.split('.')[1],
            incomplete_details: { reason: 'max_output_tokens' },
            error: { message: 'test failure' },
          },
        },
      ]) as any,
      { enableStreaming: true },
      { requireTerminalEvent: true },
    );
    const result = await inspectCompatibleCheck(sseResponse(await new Response(stream).text()));

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
  });

  it('rejects Responses upstream EOF because the runtime adds an error terminal', async () => {
    const stream = OpenAIResponsesStream(chunks([]) as any, { enableStreaming: true }, {
      requireTerminalEvent: true,
    });
    const result = await inspectCompatibleCheck(sseResponse(await new Response(stream).text()));

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
  });

  it('accepts ordinary streamed text without treating EOF as completion', async () => {
    const result = await inspectCompatibleCheck(sseResponse('event: text\ndata: "hello"\n\n'));

    expect(result.text).toBe('hello');
    expect(result.streamCompleted).toBeUndefined();
    expect(result.pass).toBe(true);
  });

  it('rejects a comment-only SSE capture without recovering heartbeat text', async () => {
    const result = await inspectCompatibleCheck(sseResponse(': chathub-ping\n\n'));

    expect(result.text).toBe('');
    expect(result.streamCompleted).toBeUndefined();
    expect(result.pass).toBe(false);
  });

  it('still extracts Chat Completions text after heartbeat comments', async () => {
    const result = await inspectCompatibleCheck(
      sseResponse(': chathub-ping\n\nevent: text\ndata: "pong"\n\n'),
    );

    expect(result.text).toBe('pong');
    expect(result.streamCompleted).toBeUndefined();
    expect(result.pass).toBe(true);
  });

  it('still accepts an explicit empty Chat Completions stop after heartbeats', async () => {
    const result = await inspectCompatibleCheck(
      sseResponse(': chathub-ping\n\nevent: stop\ndata: "stop"\n\n'),
    );

    expect(result.text).toBe('');
    expect(result.streamCompleted).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('rejects an empty Chat Completions iterator wrapped with the server heartbeat', async () => {
    const stream = OpenAIStream(chunks([]) as any, { enableStreaming: true });
    const result = await inspectCompatibleCheck(
      StreamingResponse(stream, { heartbeatIntervalMs: SSE_HEARTBEAT_INTERVAL_MS }),
    );

    expect(result.text).toBe('');
    expect(result.streamCompleted).toBeUndefined();
    expect(result.pass).toBe(false);
  });

  it('still accepts explicit empty Chat Completions stop under the server heartbeat wrapper', async () => {
    const stream = OpenAIStream(
      chunks([
        {
          id: 'probe',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ]) as any,
      { enableStreaming: true },
    );
    const result = await inspectCompatibleCheck(
      StreamingResponse(stream, { heartbeatIntervalMs: SSE_HEARTBEAT_INTERVAL_MS }),
    );

    expect(result.text).toBe('');
    expect(result.streamCompleted).toBe(true);
    expect(result.pass).toBe(true);
  });
});
