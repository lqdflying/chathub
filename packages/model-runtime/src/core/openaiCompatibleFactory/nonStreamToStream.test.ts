// @vitest-environment node
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIResponsesStream } from '../streams/openai/responsesStream';
import { readStreamChunk } from '../streams/utils';
import { transformResponseAPIToStream, transformResponseToStream } from './nonStreamToStream';

const readResponseEvents = async (response: OpenAI.Responses.Response) => {
  const reader = transformResponseAPIToStream(response).getReader();
  const events: OpenAI.Responses.ResponseStreamEvent[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    events.push(value);
  }

  return events;
};

const responseEventTypes = (events: OpenAI.Responses.ResponseStreamEvent[]) =>
  events.map((event) => event.type);

describe('nonStreamToStream', () => {
  describe('transformResponseToStream', () => {
    it('should transform ChatCompletion to stream events correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you today?',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: content chunk
        {
          choices: [
            {
              delta: {
                content: 'Hello! How can I help you today?',
                role: 'assistant',
                tool_calls: undefined,
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
        },
        // Second chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Third chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should transform ChatCompletion with reasoning_content to stream events correctly', async () => {
      const mockResponse: unknown = {
        id: 'chatcmpl-reasoning-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'Let me think about this step by step...',
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse as OpenAI.ChatCompletion);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: reasoning chunk
        {
          choices: [
            {
              delta: {
                content: null,
                reasoning_content: 'Let me think about this step by step...',
                role: 'assistant',
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
        },
        // Second chunk: content chunk
        {
          choices: [
            {
              delta: {
                content: 'The answer is 42.',
                role: 'assistant',
                tool_calls: undefined,
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
        },
        // Third chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Fourth chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should transform ChatCompletion with tool_calls to stream events correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-tool-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'I need to check the weather for you.',
              refusal: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "New York"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: content and tool_calls chunk
        {
          choices: [
            {
              delta: {
                content: 'I need to check the weather for you.',
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      name: 'get_weather',
                      arguments: '{"location": "New York"}',
                    },
                    id: 'call_abc123',
                    index: 0,
                    type: 'function',
                  },
                ],
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
        },
        // Second chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Third chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'tool_calls',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should handle empty choices array', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-empty-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 0,
          total_tokens: 13,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(3);

      // Verify all chunks have empty choices array structure
      expect(chunks[0].choices).toEqual([]);
      expect(chunks[1]).toEqual({
        choices: [],
        created: 1677652288,
        id: 'chatcmpl-empty-123',
        model: 'gpt-3.5-turbo',
        object: 'chat.completion.chunk',
        usage: {
          prompt_tokens: 13,
          completion_tokens: 0,
          total_tokens: 13,
        },
      });
      expect(chunks[2].choices).toEqual([]);
    });
  });

  describe('transformResponseAPIToStream', () => {
    it('should transform Response API with text output to stream events correctly', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_abc123',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            id: 'msg_001',
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Hello! How can I help you today?',
              } as any,
            ],
          },
        ],
        usage: {
          total_tokens: 20,
          input_tokens: 13,
          output_tokens: 7,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const events = await readResponseEvents(mockResponse);

      expect(responseEventTypes(events)).toEqual([
        'response.created',
        'response.output_item.added',
        'response.output_text.delta',
        'response.output_item.done',
        'response.completed',
      ]);
      expect(events.map((event) => event.sequence_number)).toEqual([0, 1, 2, 3, 4]);
      expect(events[2]).toMatchObject({
        delta: 'Hello! How can I help you today?',
        item_id: 'msg_001',
        output_index: 0,
      });
      expect(events.at(-1)).toMatchObject({ response: mockResponse });
    });

    it('should handle Response API without message output', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_no_message',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            id: 'audio_001',
            object: 'realtime.item',
            type: 'message' as any,
            status: 'completed',
            // Missing content property
          },
        ],
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const events = await readResponseEvents(mockResponse);

      expect(responseEventTypes(events)).toEqual([
        'response.created',
        'response.output_item.added',
        'response.output_item.done',
        'response.completed',
      ]);
      expect(events.at(-1)).toMatchObject({ response: mockResponse });
    });

    it('should handle Response API with message but no text content', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_no_text',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            id: 'msg_no_text',
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text' as any,
                audio: 'base64encodedaudio',
                // No text property
              },
            ],
          },
        ],
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const events = await readResponseEvents(mockResponse);

      expect(responseEventTypes(events)).toEqual([
        'response.created',
        'response.output_item.added',
        'response.output_item.done',
        'response.completed',
      ]);
      expect(events.some((event) => event.type === 'response.output_text.delta')).toBe(false);
    });

    it('should handle Response API with message id missing', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_missing_id',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [
          {
            // id is missing
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Response without message ID',
              } as any,
            ],
          },
        ],
        usage: {
          total_tokens: 15,
          input_tokens: 10,
          output_tokens: 5,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const events = await readResponseEvents(mockResponse);

      expect(responseEventTypes(events)).toEqual([
        'response.created',
        'response.output_item.added',
        'response.output_text.delta',
        'response.output_item.done',
        'response.completed',
      ]);
      expect(events[2]).toMatchObject({
        delta: 'Response without message ID',
        item_id: 'resp_missing_id:output:0',
      });
    });

    it('should handle empty output array', async () => {
      const mockResponse: OpenAI.Responses.Response = {
        id: 'resp_empty_output',
        object: 'response',
        status: 'completed',
        status_details: null,
        output: [],
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const events = await readResponseEvents(mockResponse);

      expect(responseEventTypes(events)).toEqual(['response.created', 'response.completed']);
      expect(events.at(-1)).toMatchObject({ response: mockResponse });
    });

    it('should handle missing output field', async () => {
      const mockResponse: Partial<OpenAI.Responses.Response> = {
        id: 'resp_no_output',
        object: 'response',
        status: 'completed',
        status_details: null,
        // output field is missing
        usage: {
          total_tokens: 5,
          input_tokens: 5,
          output_tokens: 0,
          input_tokens_details: { audio_tokens: 0, cache_read_tokens: 0 },
          output_tokens_details: { audio_tokens: 0, reasoning_tokens: 0 },
        },
        created: 1677652288,
        created_at: 1677652288,
        model: 'gpt-4o-realtime-preview',
      } as any;

      const events = await readResponseEvents(mockResponse as OpenAI.Responses.Response);

      expect(responseEventTypes(events)).toEqual(['response.created', 'response.completed']);
      expect(events.at(-1)).toMatchObject({ response: mockResponse });
    });

    it('should preserve reasoning, tools, refusal, citations, and usage through the protocol stream', async () => {
      const mockResponse = {
        id: 'resp_semantic_output',
        model: 'gpt-5',
        object: 'response',
        output: [
          {
            id: 'reasoning_1',
            status: 'completed',
            summary: [{ text: 'Reasoning summary', type: 'summary_text' }],
            type: 'reasoning',
          },
          {
            arguments: '{"city":"Paris"}',
            call_id: 'call_weather',
            id: 'function_1',
            name: 'get_weather',
            status: 'completed',
            type: 'function_call',
          },
          {
            content: [
              {
                annotations: [
                  {
                    end_index: 16,
                    start_index: 0,
                    title: 'Weather source',
                    type: 'url_citation',
                    url: 'https://example.com/weather',
                  },
                ],
                text: 'Weather is sunny.',
                type: 'output_text',
              },
              {
                refusal: 'I cannot provide restricted details.',
                type: 'refusal',
              },
            ],
            id: 'message_1',
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
        ],
        status: 'completed',
        usage: {
          input_tokens: 20,
          input_tokens_details: { cached_tokens: 5 },
          output_tokens: 10,
          output_tokens_details: { reasoning_tokens: 3 },
          total_tokens: 30,
        },
      } as unknown as OpenAI.Responses.Response;
      const onCompletion = vi.fn();

      const events = await readResponseEvents(mockResponse);
      const protocolChunks = await readStreamChunk(
        OpenAIResponsesStream(
          transformResponseAPIToStream(mockResponse),
          { callbacks: { onCompletion } },
          { requireTerminalEvent: true },
        ),
      );
      const protocolOutput = protocolChunks.join('');

      expect(responseEventTypes(events)).toEqual([
        'response.created',
        'response.output_item.added',
        'response.reasoning_summary_part.added',
        'response.reasoning_summary_text.delta',
        'response.output_item.done',
        'response.output_item.added',
        'response.function_call_arguments.done',
        'response.output_item.done',
        'response.output_item.added',
        'response.output_text.delta',
        'response.output_text.annotation.added',
        'response.refusal.delta',
        'response.output_item.done',
        'response.completed',
      ]);
      expect(protocolOutput).toContain('event: reasoning');
      expect(protocolOutput).toContain('Reasoning summary');
      expect(protocolOutput).toContain('event: tool_calls');
      expect(protocolOutput).toContain('get_weather');
      expect(protocolOutput).toContain('{\\"city\\":\\"Paris\\"}');
      expect(protocolOutput).toContain('Weather is sunny.');
      expect(protocolOutput).toContain('I cannot provide restricted details.');
      expect(protocolOutput).toContain('event: grounding');
      expect(protocolOutput).toContain('https://example.com/weather');
      expect(protocolOutput).toContain('event: usage');
      expect(onCompletion).toHaveBeenCalledOnce();
    });

    it.each([
      { expectedEventType: 'response.failed', status: 'failed' },
      { expectedEventType: 'response.incomplete', status: 'incomplete' },
      { expectedEventType: 'response.incomplete', status: 'cancelled' },
    ])(
      'should map $status responses to $expectedEventType without successful completion',
      async ({ expectedEventType, status }) => {
        const mockResponse = {
          error:
            status === 'failed'
              ? { code: 'server_error', message: 'Generation failed' }
              : null,
          id: `resp_${status}`,
          incomplete_details:
            status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
          object: 'response',
          output: [],
          status,
        } as unknown as OpenAI.Responses.Response;
        const onCompletion = vi.fn();
        const onFinal = vi.fn();

        const events = await readResponseEvents(mockResponse);
        const protocolChunks = await readStreamChunk(
          OpenAIResponsesStream(
            transformResponseAPIToStream(mockResponse),
            { callbacks: { onCompletion, onFinal } },
            { requireTerminalEvent: true },
          ),
        );

        expect(events.at(-1)?.type).toBe(expectedEventType);
        expect(protocolChunks.join('')).toContain('event: error');
        expect(onCompletion).not.toHaveBeenCalled();
        expect(onFinal).toHaveBeenCalledOnce();
      },
    );
  });
});
