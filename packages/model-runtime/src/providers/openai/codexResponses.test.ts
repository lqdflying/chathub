// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildCodexResponsesHeaders,
  buildCodexResponsesPayload,
  buildCodexResponsesUrl,
  parseCodexResponsesSse,
} from './codexResponses';

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
});
