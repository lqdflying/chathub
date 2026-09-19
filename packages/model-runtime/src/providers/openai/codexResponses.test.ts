// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStreamChunk } from '../../core/streams/utils';
import { OPENAI_CODEX_DEBUG_NAMESPACE } from './codexDebug';
import {
  buildCodexResponsesHeaders,
  buildCodexResponsesPayload,
  buildCodexResponsesUrl,
  chatWithCodexResponses,
  parseCodexResponsesSse,
} from './codexResponses';

const sseFrame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
const createdFrame = sseFrame({
  response: { id: 'resp_created', status: 'in_progress' },
  type: 'response.created',
});

const readChatStreamSettled = (logs: ReturnType<typeof vi.spyOn>) => {
  const settled = logs.mock.calls.filter(
    ([prefix]) => prefix === `[${OPENAI_CODEX_DEBUG_NAMESPACE}:chat_stream_settled]`,
  );
  expect(settled).toHaveLength(1);
  return JSON.parse(settled[0][1] as string);
};

describe('codexResponses', () => {
  it('builds the Codex responses URL and ChatHub attribution headers', () => {
    expect(buildCodexResponsesUrl()).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(
      buildCodexResponsesHeaders({
        accessToken: 'tok',
        accountId: 'acct_1',
        requestId: 'req-1',
      }),
    ).toMatchObject({
      Authorization: 'Bearer tok',
      'OpenAI-Beta': 'responses=experimental',
      'User-Agent': 'ChatHub',
      accept: 'text/event-stream',
      'chatgpt-account-id': 'acct_1',
      originator: 'chathub',
      session_id: 'req-1',
    });
  });

  it('moves system text into instructions and keeps store:false streaming', async () => {
    const body = await buildCodexResponsesPayload({
      messages: [
        { content: 'Be brief.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ],
      model: 'gpt-5.4',
      reasoning_effort: 'medium',
      tools: [
        {
          function: { name: 'lookup', parameters: { type: 'object' } },
          type: 'function',
        },
      ],
      verbosity: 'low',
    } as any);

    expect(body).toMatchObject({
      include: ['reasoning.encrypted_content'],
      instructions: 'Be brief.',
      model: 'gpt-5.4',
      reasoning: { effort: 'medium' },
      store: false,
      stream: true,
      text: { verbosity: 'low' },
    });
    expect(body.tools?.[0]).toMatchObject({ name: 'lookup', strict: false });
    expect(JSON.stringify(body.input)).toContain('Hello');
    expect(JSON.stringify(body.input)).not.toContain('Be brief.');
  });

  it('parses Codex SSE fixtures into JSON events', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.created\ndata: {"type":"response.created","id":"resp_1"}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseCodexResponsesSse(new Response(stream))) {
      events.push(event);
    }

    expect(events).toEqual([{ id: 'resp_1', type: 'response.created' }]);
  });

  it('forwards stream lifecycle callbacks on a completed Codex response', async () => {
    const callbacks = {
      onCancel: vi.fn(),
      onCompletion: vi.fn(),
      onFinal: vi.fn(),
      onStart: vi.fn(),
    };
    const sse =
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}\n\n';

    const response = await chatWithCodexResponses({
      accessToken: 'tok',
      accountId: 'acct_1',
      fetchFn: vi.fn().mockResolvedValue(new Response(sse, { status: 200 })),
      options: { callback: callbacks },
      payload: { messages: [{ content: 'Hello', role: 'user' }], model: 'gpt-5.4' } as any,
    });

    expect(response.body).toBeTruthy();
    await readStreamChunk(response.body!);

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onCompletion).toHaveBeenCalledTimes(1);
    expect(callbacks.onFinal).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it('invokes onCancel once when the consumer cancels the stream', async () => {
    const callbacks = {
      onCancel: vi.fn(),
      onCompletion: vi.fn(),
      onFinal: vi.fn(),
      onStart: vi.fn(),
    };
    const stream = new ReadableStream({
      start() {
        // Stay open until the consumer cancels.
      },
    });

    const response = await chatWithCodexResponses({
      accessToken: 'tok',
      accountId: 'acct_1',
      fetchFn: vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
      options: { callback: callbacks },
      payload: { messages: [{ content: 'Hello', role: 'user' }], model: 'gpt-5.4' } as any,
    });

    await response.body?.cancel('user_stop');
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onCompletion).not.toHaveBeenCalled();
  });

  describe('CHATHUB_OPENAI_CODEX_DEBUG stream outcomes', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    const consumeDebugStream = async (body: BodyInit | null, callbacks = {}) => {
      vi.stubEnv('CHATHUB_OPENAI_CODEX_DEBUG', '1');
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const response = await chatWithCodexResponses({
        accessToken: 'tok',
        accountId: 'acct_1',
        fetchFn: vi.fn().mockResolvedValue(
          new Response(body, { headers: { 'content-type': 'text/event-stream' }, status: 200 }),
        ),
        options: { callback: callbacks },
        payload: { messages: [{ content: 'Hello', role: 'user' }], model: 'gpt-5.4' } as any,
      });
      return { logs, response };
    };

    it('logs ok only after a completed Responses lifecycle', async () => {
      const onCompletion = vi.fn();
      const onError = vi.fn();
      const { logs, response } = await consumeDebugStream(
        sseFrame({
          response: { id: 'resp_1', status: 'completed' },
          type: 'response.completed',
        }),
        { onCompletion, onError },
      );

      await response.text();
      expect(onCompletion).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(readChatStreamSettled(logs)).toMatchObject({
        outcome: 'ok',
        sseEventCount: 1,
      });
    });

    it.each([
      {
        body: sseFrame({
          response: { error: { code: 'quota_exceeded', message: 'test failure' } },
          type: 'response.failed',
        }),
        expected: { outcome: 'failed', reason: 'response_failed', sseEventCount: 1 },
        name: 'failed',
      },
      {
        body: sseFrame({
          response: { incomplete_details: { reason: 'max_output_tokens' } },
          type: 'response.incomplete',
        }),
        expected: { outcome: 'incomplete', reason: 'max_output_tokens', sseEventCount: 1 },
        name: 'incomplete',
      },
      {
        body: createdFrame,
        expected: { outcome: 'unexpected_end', reason: 'missing_terminal_event', sseEventCount: 1 },
        name: 'missing terminal',
      },
      {
        body: `${createdFrame}data: invalid-json\n\n`,
        expected: { outcome: 'parse_error', reason: 'invalid_json', sseEventCount: 1 },
        name: 'invalid JSON',
      },
      {
        body: '',
        expected: { outcome: 'empty', sseEventCount: 0 },
        name: 'zero events',
      },
    ])('logs $name from the Responses terminal, not event count', async ({ body, expected }) => {
      const onCompletion = vi.fn();
      const onError = vi.fn();
      const { logs, response } = await consumeDebugStream(body, { onCompletion, onError });
      const output = await response.text();

      expect(output).toContain('event: error');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onCompletion).not.toHaveBeenCalled();
      expect(readChatStreamSettled(logs)).toMatchObject(expected);
    });

    it('logs cancelled once when the consumer cancels the stream', async () => {
      const onCancel = vi.fn();
      const onCompletion = vi.fn();
      const { logs, response } = await consumeDebugStream(
        new ReadableStream({
          start() {
            // Stay open until the consumer cancels.
          },
        }),
        { onCancel, onCompletion },
      );

      await response.body?.cancel('user_stop');
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCompletion).not.toHaveBeenCalled();
      expect(readChatStreamSettled(logs)).toMatchObject({ outcome: 'cancelled' });
    });
  });
});
