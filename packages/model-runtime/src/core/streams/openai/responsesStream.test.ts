import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../../types/error';
import { FIRST_CHUNK_ERROR_KEY } from '../protocol';
import { createReadableStream, readStreamChunk } from '../utils';
import { OpenAIResponsesStream } from './responsesStream';

describe('OpenAIResponsesStream', () => {
  it('should log cache debug usage when enabled', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockOpenAIStream = createReadableStream([
      {
        response: {
          id: 'resp_cache',
          status: 'completed',
          usage: {
            input_tokens: 128,
            input_tokens_details: { cached_tokens: 64 },
            output_tokens: 7,
            total_tokens: 135,
          },
        },
        type: 'response.completed',
      },
    ]);

    await readStreamChunk(
      OpenAIResponsesStream(mockOpenAIStream as any, {
        payload: {
          debugOpenAICompatCache: true,
          model: 'gpt-5.5',
          provider: 'openaicompatible',
        },
      }),
    );

    const cacheLog = consoleLogSpy.mock.calls.find(
      ([label]) => label === '[openai-compatible-cache-debug:usage]',
    );
    expect(cacheLog).toBeDefined();
    expect(JSON.parse(cacheLog![1] as string)).toMatchObject({
      cachedTokens: 64,
      cacheMissTokens: 64,
      inputTokens: 128,
      model: 'gpt-5.5',
      outputTokens: 7,
      responseId: {
        hash: expect.stringMatching(/^[\da-f]{8}$/),
        present: true,
      },
      route: '/responses',
      totalTokens: 135,
    });
    expect(cacheLog![1]).not.toContain('resp_cache');

    consoleLogSpy.mockRestore();
  });

  it('should transform OpenAI stream to protocol stream', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_683e7b8ca3308190b6837f20d2c015cd0cf93af363cdcf58',
          object: 'response',
          created_at: 1748925324,
          status: 'in_progress',
          error: null,
          incomplete_details: null,
          instructions: null,
          max_output_tokens: null,
          model: 'o4-mini',
          output: [],
          parallel_tool_calls: true,
          previous_response_id: null,
          reasoning: { effort: 'medium', summary: null },
          service_tier: 'auto',
          store: false,
          temperature: 1,
          text: { format: { type: 'text' } },
          tool_choice: 'auto',
          tools: [
            {
              type: 'function',
              description:
                'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
              name: 'lobe-web-browsing____search____builtin',
              parameters: {
                properties: {
                  query: { description: 'The search query', type: 'string' },
                  searchCategories: {
                    description: 'The search categories you can set:',
                    items: {
                      enum: ['general', 'images', 'news', 'science', 'videos'],
                      type: 'string',
                    },
                    type: 'array',
                  },
                  searchEngines: {
                    description: 'The search engines you can use:',
                    items: {
                      enum: [
                        'google',
                        'bilibili',
                        'bing',
                        'duckduckgo',
                        'npm',
                        'pypi',
                        'github',
                        'arxiv',
                        'google scholar',
                        'z-library',
                        'reddit',
                        'imdb',
                        'brave',
                        'wikipedia',
                        'pinterest',
                        'unsplash',
                        'vimeo',
                        'youtube',
                      ],
                      type: 'string',
                    },
                    type: 'array',
                  },
                  searchTimeRange: {
                    description: 'The time range you can set:',
                    enum: ['anytime', 'day', 'week', 'month', 'year'],
                    type: 'string',
                  },
                },
                required: ['query'],
                type: 'object',
              },
              strict: true,
            },
            {
              type: 'function',
              description:
                'A crawler can visit page content. Output is a JSON object of title, content, url and website',
              name: 'lobe-web-browsing____crawlSinglePage____builtin',
              parameters: {
                properties: { url: { description: 'The url need to be crawled', type: 'string' } },
                required: ['url'],
                type: 'object',
              },
              strict: true,
            },
            {
              type: 'function',
              description:
                'A crawler can visit multi pages. If need to visit multi website, use this one. Output is an array of JSON object of title, content, url and website',
              name: 'lobe-web-browsing____crawlMultiPages____builtin',
              parameters: {
                properties: {
                  urls: {
                    items: { description: 'The urls need to be crawled', type: 'string' },
                    type: 'array',
                  },
                },
                required: ['urls'],
                type: 'object',
              },
              strict: true,
            },
          ],
          top_p: 1,
          truncation: 'disabled',
          usage: null,
          user: null,
          metadata: {},
        },
      },
      {
        type: 'response.in_progress',
        response: {
          id: 'resp_683e7b8ca3308190b6837f20d2c015cd0cf93af363cdcf58',
          object: 'response',
          created_at: 1748925324,
          status: 'in_progress',
          error: null,
          incomplete_details: null,
          instructions: null,
          max_output_tokens: null,
          model: 'o4-mini',
          output: [],
          parallel_tool_calls: true,
          previous_response_id: null,
          reasoning: { effort: 'medium', summary: null },
          service_tier: 'auto',
          store: false,
          temperature: 1,
          text: { format: { type: 'text' } },
          tool_choice: 'auto',
          tools: [
            {
              type: 'function',
              description:
                'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
              name: 'lobe-web-browsing____search____builtin',
              parameters: {
                properties: {
                  query: { description: 'The search query', type: 'string' },
                  searchCategories: {
                    description: 'The search categories you can set:',
                    items: {
                      enum: ['general', 'images', 'news', 'science', 'videos'],
                      type: 'string',
                    },
                    type: 'array',
                  },
                  searchEngines: {
                    description: 'The search engines you can use:',
                    items: {
                      enum: [
                        'google',
                        'bilibili',
                        'bing',
                        'duckduckgo',
                        'npm',
                        'pypi',
                        'github',
                        'arxiv',
                        'google scholar',
                        'z-library',
                        'reddit',
                        'imdb',
                        'brave',
                        'wikipedia',
                        'pinterest',
                        'unsplash',
                        'vimeo',
                        'youtube',
                      ],
                      type: 'string',
                    },
                    type: 'array',
                  },
                  searchTimeRange: {
                    description: 'The time range you can set:',
                    enum: ['anytime', 'day', 'week', 'month', 'year'],
                    type: 'string',
                  },
                },
                required: ['query'],
                type: 'object',
              },
              strict: true,
            },
            {
              type: 'function',
              description:
                'A crawler can visit page content. Output is a JSON object of title, content, url and website',
              name: 'lobe-web-browsing____crawlSinglePage____builtin',
              parameters: {
                properties: { url: { description: 'The url need to be crawled', type: 'string' } },
                required: ['url'],
                type: 'object',
              },
              strict: true,
            },
            {
              type: 'function',
              description:
                'A crawler can visit multi pages. If need to visit multi website, use this one. Output is an array of JSON object of title, content, url and website',
              name: 'lobe-web-browsing____crawlMultiPages____builtin',
              parameters: {
                properties: {
                  urls: {
                    items: { description: 'The urls need to be crawled', type: 'string' },
                    type: 'array',
                  },
                },
                required: ['urls'],
                type: 'object',
              },
              strict: true,
            },
          ],
          top_p: 1,
          truncation: 'disabled',
          usage: null,
          user: null,
          metadata: {},
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          id: 'rs_683e7bc80a9c81908f6e3d61ad63cc1e0cf93af363cdcf58',
          type: 'reasoning',
          summary: [],
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: {
          id: 'msg_683e7bde8b0c8190970ab8c719c0fc1c0cf93af363cdcf58',
          type: 'message',
          status: 'in_progress',
          content: [],
          role: 'assistant',
        },
      },
      {
        type: 'response.content_part.added',
        item_id: 'msg_683e7bde8b0c8190970ab8c719c0fc1c0cf93af363cdcf58',
        output_index: 1,
        content_index: 0,
        part: { type: 'output_text', annotations: [], text: 'Hello' },
      },
      {
        type: 'response.content_part.added',
        item_id: 'msg_683e7bde8b0c8190970ab8c719c0fc1c0cf93af363cdcf58',
        output_index: 1,
        content_index: 0,
        part: { type: 'output_text', annotations: [], text: ' world' },
      },
    ]);

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream, {
      callbacks: {
        onStart: onStartMock,
        onText: onTextMock,
        onCompletion: onCompletionMock,
      },
    });

    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onCompletionMock).not.toHaveBeenCalled();
  });
  it('should handle first chunk error with FIRST_CHUNK_ERROR_KEY', async () => {
    const mockErrorChunk = {
      [FIRST_CHUNK_ERROR_KEY]: true,
      message: 'Invalid API key',
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      name: 'APIError',
      stack: 'stack trace',
    };

    const mockOpenAIStream = createReadableStream([mockErrorChunk]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('id: first_chunk_error'))).toBe(true);
    expect(chunks.some((c) => c.includes('event: error'))).toBe(true);
  });

  it('should handle first chunk error with message object', async () => {
    const mockErrorChunk = {
      [FIRST_CHUNK_ERROR_KEY]: true,
      message: { error: 'API quota exceeded', code: 429 },
    };

    const mockOpenAIStream = createReadableStream([mockErrorChunk]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('id: first_chunk_error'))).toBe(true);
  });

  it('should handle first chunk error without message', async () => {
    const mockErrorChunk = {
      [FIRST_CHUNK_ERROR_KEY]: true,
      code: 'rate_limit_exceeded',
      status: 429,
    };

    const mockOpenAIStream = createReadableStream([mockErrorChunk]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('id: first_chunk_error'))).toBe(true);
  });

  it.each([
    {
      emittedEvents: [],
      expectedId: 'first_chunk_error',
      name: 'before the first event',
    },
    {
      emittedEvents: [
        {
          response: { id: 'resp_html_error', status: 'in_progress' },
          type: 'response.created',
        },
      ],
      expectedId: 'resp_html_error',
      name: 'after a valid event',
    },
  ])(
    'should sanitize an HTML Responses stream failure $name',
    async ({ emittedEvents, expectedId }) => {
      const onCompletion = vi.fn();
      const onError = vi.fn();
      const onFinal = vi.fn();
      let eventIndex = 0;
      const mockOpenAIStream = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          if (eventIndex < emittedEvents.length) {
            const value = emittedEvents[eventIndex];
            eventIndex += 1;
            return { done: false, value };
          }

          throw new SyntaxError(
            `Unexpected token '<', "<!DOCTYPE html><title>Gateway error</title>" is not valid JSON`,
          );
        },
      };

      const chunks = await readStreamChunk(
        OpenAIResponsesStream(
          mockOpenAIStream as any,
          { callbacks: { onCompletion, onError, onFinal } },
          { requireTerminalEvent: true },
        ),
      );
      const streamOutput = chunks.join('');

      expect(streamOutput).toContain(`id: ${expectedId}`);
      expect(streamOutput).toContain('event: error');
      expect(streamOutput).toContain('html_response');
      expect(streamOutput).toContain(
        'The provider returned HTML instead of a valid Responses API stream.',
      );
      expect(streamOutput).not.toContain('<!DOCTYPE');
      expect(streamOutput).not.toContain('Gateway error');
      expect(streamOutput).not.toContain('Unexpected token');
      expect(onCompletion).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Object), {
        terminalReason: 'html_response',
        terminalSource: 'upstream_iterator_exception',
      });
      expect(onFinal).toHaveBeenCalledOnce();
    },
  );

  it('should classify a non-HTML JSON parse failure as an invalid Responses stream', async () => {
    const onError = vi.fn();
    const mockOpenAIStream = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    };

    const chunks = await readStreamChunk(
      OpenAIResponsesStream(
        mockOpenAIStream as any,
        { callbacks: { onError } },
        {
          requireTerminalEvent: true,
        },
      ),
    );
    const streamOutput = chunks.join('');

    expect(streamOutput).toContain('event: error');
    expect(streamOutput).toContain('invalid_json');
    expect(streamOutput).toContain('The provider returned a malformed Responses API stream.');
    expect(streamOutput).not.toContain('Unexpected end of JSON input');
    expect(onError).toHaveBeenCalledWith(expect.any(Object), {
      terminalReason: 'invalid_json',
      terminalSource: 'upstream_iterator_exception',
    });
  });

  it('should handle response.created event', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_test_123',
          status: 'in_progress',
          object: 'response',
          created_at: 1234567890,
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('id: resp_test_123'))).toBe(true);
    expect(chunks.some((c) => c.includes('"in_progress"'))).toBe(true);
  });

  it('should handle function_call in response.output_item.added', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_test_456',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          call_id: 'call_abc123',
          name: 'get_weather',
          arguments: '{"location": "San Francisco"}',
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('event: tool_calls'))).toBe(true);
    expect(chunks.some((c) => c.includes('get_weather'))).toBe(true);
  });

  it('should handle multiple function_calls with incrementing index', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_multi_tool',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'tool_one',
          arguments: '{"param": "value1"}',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: {
          type: 'function_call',
          call_id: 'call_2',
          name: 'tool_two',
          arguments: '{"param": "value2"}',
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.filter((c) => c.includes('event: tool_calls')).length).toBeGreaterThan(0);
  });

  it('should handle response.function_call_arguments.delta', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_delta_test',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          call_id: 'call_delta',
          name: 'search_web',
          arguments: '{"query":',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'call_delta',
        delta: ' "OpenAI"}',
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('search_web'))).toBe(true);
  });

  it('should correlate interleaved parallel tool deltas by item id', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        response: { id: 'resp_parallel_tools', status: 'in_progress' },
        type: 'response.created',
      },
      {
        item: {
          arguments: '',
          call_id: 'call_first',
          id: 'item_first',
          name: 'first_tool',
          type: 'function_call',
        },
        output_index: 0,
        type: 'response.output_item.added',
      },
      {
        item: {
          arguments: '',
          call_id: 'call_second',
          id: 'item_second',
          name: 'second_tool',
          type: 'function_call',
        },
        output_index: 1,
        type: 'response.output_item.added',
      },
      {
        delta: '{"second":true}',
        item_id: 'item_second',
        output_index: 1,
        type: 'response.function_call_arguments.delta',
      },
      {
        delta: '{"first":true}',
        item_id: 'item_first',
        output_index: 0,
        type: 'response.function_call_arguments.delta',
      },
      {
        arguments: '{"first":true}',
        item_id: 'item_first',
        name: 'first_tool',
        output_index: 0,
        type: 'response.function_call_arguments.done',
      },
      {
        arguments: '{"second":true}',
        item_id: 'item_second',
        name: 'second_tool',
        output_index: 1,
        type: 'response.function_call_arguments.done',
      },
      {
        response: { id: 'resp_parallel_tools', status: 'completed' },
        type: 'response.completed',
      },
    ]);

    const chunks = await readStreamChunk(
      OpenAIResponsesStream(mockOpenAIStream, undefined, { requireTerminalEvent: true }),
    );
    const streamOutput = chunks.join('');

    expect(streamOutput).toContain(
      '"function":{"arguments":"{\\"second\\":true}","name":"second_tool"},"id":"call_second","index":1',
    );
    expect(streamOutput).toContain(
      '"function":{"arguments":"{\\"first\\":true}","name":"first_tool"},"id":"call_first","index":0',
    );
    expect(streamOutput.match(/\\"first\\":true/g)).toHaveLength(1);
    expect(streamOutput.match(/\\"second\\":true/g)).toHaveLength(1);
  });

  it('should emit finalized tool arguments when no deltas were received', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        response: { id: 'resp_done_only', status: 'in_progress' },
        type: 'response.created',
      },
      {
        item: {
          arguments: '',
          call_id: 'call_done_only',
          id: 'item_done_only',
          name: 'done_only_tool',
          type: 'function_call',
        },
        output_index: 0,
        type: 'response.output_item.added',
      },
      {
        arguments: '{"value":42}',
        item_id: 'item_done_only',
        name: 'done_only_tool',
        output_index: 0,
        type: 'response.function_call_arguments.done',
      },
      {
        response: { id: 'resp_done_only', status: 'completed' },
        type: 'response.completed',
      },
    ]);

    const chunks = await readStreamChunk(
      OpenAIResponsesStream(mockOpenAIStream, undefined, { requireTerminalEvent: true }),
    );

    expect(chunks.join('')).toContain(
      '"function":{"arguments":"{\\"value\\":42}","name":"done_only_tool"}',
    );
  });

  it('should handle response.output_text.delta', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_text_delta',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_123',
        delta: 'Hello ',
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_123',
        delta: 'world!',
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('event: text'))).toBe(true);
    expect(chunks.some((c) => c.includes('Hello '))).toBe(true);
    expect(chunks.some((c) => c.includes('world!'))).toBe(true);
  });

  it('should handle response.reasoning_summary_part.added for first part', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_reasoning',
          status: 'in_progress',
        },
      },
      {
        type: 'response.reasoning_summary_part.added',
        item_id: 'reasoning_1',
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('event: reasoning'))).toBe(true);
  });

  it('should handle response.reasoning_summary_part.added for subsequent parts', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_reasoning_multi',
          status: 'in_progress',
        },
      },
      {
        type: 'response.reasoning_summary_part.added',
        item_id: 'reasoning_1',
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
      },
      {
        type: 'response.reasoning_summary_part.added',
        item_id: 'reasoning_2',
        summary_index: 1,
        part: { type: 'summary_text', text: '' },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.filter((c) => c.includes('event: reasoning')).length).toBeGreaterThan(0);
  });

  it('should handle response.reasoning_summary_text.delta', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_reasoning_delta',
          status: 'in_progress',
        },
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'reasoning_123',
        output_index: 0,
        summary_index: 0,
        delta: 'Thinking about',
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'reasoning_123',
        output_index: 0,
        summary_index: 0,
        delta: ' the problem...',
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('Thinking about'))).toBe(true);
    expect(chunks.some((c) => c.includes(' the problem...'))).toBe(true);
  });

  it('should strip empty HTML comments from GPT-5.6 reasoning summaries', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        response: {
          id: 'resp_gpt56_reasoning',
          status: 'in_progress',
        },
        type: 'response.created',
      },
      {
        delta: '**Planning weather data crawling**\n\n<!-- -->',
        item_id: 'reasoning_gpt56',
        output_index: 0,
        summary_index: 0,
        type: 'response.reasoning_summary_text.delta',
      },
    ]);
    const onThinkingMock = vi.fn();
    const protocolStream = OpenAIResponsesStream(mockOpenAIStream, {
      callbacks: { onThinking: onThinkingMock },
    });
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks.join('')).toContain('**Planning weather data crawling**');
    expect(chunks.join('')).not.toContain('<!-- -->');
    expect(onThinkingMock).toHaveBeenCalledOnce();
    expect(onThinkingMock).toHaveBeenCalledWith('**Planning weather data crawling**\n\n');
  });

  it('should handle response.output_text.annotation.added', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_annotation',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_text.annotation.added',
        item_id: 'msg_citation',
        annotation: {
          type: 'url_citation',
          title: 'Example Source',
          url: 'https://example.com',
          start_index: 0,
          end_index: 10,
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
  });

  it('should handle multiple annotations and accumulate citations', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_multi_citation',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_text.annotation.added',
        item_id: 'msg_cite',
        annotation: {
          type: 'url_citation',
          title: 'Source 1',
          url: 'https://example1.com',
          start_index: 0,
          end_index: 10,
        },
      },
      {
        type: 'response.output_text.annotation.added',
        item_id: 'msg_cite',
        annotation: {
          type: 'url_citation',
          title: 'Source 2',
          url: 'https://example2.com',
          start_index: 11,
          end_index: 20,
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
  });

  it('should handle response.output_item.done with citations', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_done_citation',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_text.annotation.added',
        item_id: 'msg_final',
        annotation: {
          type: 'url_citation',
          title: 'Citation Title',
          url: 'https://citation.com',
          start_index: 0,
          end_index: 5,
        },
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: 'msg_final',
          type: 'message',
          status: 'completed',
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('event: grounding'))).toBe(true);
    expect(chunks.some((c) => c.includes('citations'))).toBe(true);
  });

  it('should handle response.output_item.done without citations', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_done_no_citation',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: 'msg_no_cite',
          type: 'message',
          status: 'completed',
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
  });

  it('should handle response.completed with usage', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_completed_usage',
          status: 'in_progress',
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_completed_usage',
          status: 'completed',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream, {
      payload: { model: 'gpt-4', provider: 'openai' },
    });
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('event: usage'))).toBe(true);
  });

  it('should normalize OpenAI-compatible cached tokens in response.completed usage', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_cached_usage',
          status: 'in_progress',
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_cached_usage',
          status: 'completed',
          usage: {
            cached_tokens: 64,
            input_tokens: 100,
            output_tokens: 25,
            total_tokens: 125,
          },
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream, {
      payload: { model: 'gpt-5', provider: 'openaicompatible' },
    });
    const chunks = await readStreamChunk(protocolStream);

    const usageIndex = chunks.findIndex((c) => c.includes('event: usage'));
    const usageDataChunk = chunks[usageIndex + 1];

    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(usageDataChunk).toContain('"inputCachedTokens":64');
    expect(usageDataChunk).toContain('"inputCacheMissTokens":36');
  });

  it('should preserve zero cache misses for full Responses cache hits', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.completed',
        response: {
          id: 'resp_full_cache_hit',
          status: 'completed',
          usage: {
            cached_tokens: 100,
            input_tokens: 100,
            output_tokens: 25,
            total_tokens: 125,
          },
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream, {
      payload: { model: 'gpt-5', provider: 'openaicompatible' },
    });
    const chunks = await readStreamChunk(protocolStream);

    const usageIndex = chunks.findIndex((c) => c.includes('event: usage'));
    const usageDataChunk = chunks[usageIndex + 1];

    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(usageDataChunk).toContain('"inputCachedTokens":100');
    expect(usageDataChunk).toContain('"inputCacheMissTokens":0');
  });

  it('should preserve explicit zero usage for callbacks without exposing optional zeros', async () => {
    const onUsage = vi.fn();
    const mockOpenAIStream = createReadableStream([
      {
        response: {
          id: 'resp_zero_usage',
          status: 'completed',
          usage: {
            input_tokens: 100,
            input_tokens_details: { cache_write_tokens: 0, cached_tokens: 100 },
            output_tokens: 25,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 125,
          },
        },
        type: 'response.completed',
      },
    ]);

    const chunks = await readStreamChunk(
      OpenAIResponsesStream(mockOpenAIStream, {
        callbacks: { onUsage },
        payload: { model: 'gpt-5', provider: 'openaicompatible' },
      }),
    );
    const serializedUsage = chunks.join('');

    expect(serializedUsage).toContain('"inputCacheMissTokens":0');
    expect(serializedUsage).toContain('"inputCachedTokens":100');
    expect(serializedUsage).not.toContain('"inputWriteCacheTokens":0');
    expect(serializedUsage).not.toContain('"outputReasoningTokens":0');
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputCacheMissTokens: 0,
        inputCachedTokens: 100,
        inputWriteCacheTokens: 0,
        outputReasoningTokens: 0,
      }),
    );
  });

  it('should handle response.completed without usage', async () => {
    const onCompletion = vi.fn();
    const onFinal = vi.fn();
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_completed_no_usage',
          status: 'in_progress',
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_completed_no_usage',
          status: 'completed',
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(
      mockOpenAIStream,
      { callbacks: { onCompletion, onFinal } },
      { requireTerminalEvent: true },
    );
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.join('')).toContain('event: stop');
    expect(onCompletion).toHaveBeenCalledOnce();
    expect(onFinal).toHaveBeenCalledOnce();
  });

  it.each([
    {
      event: {
        response: {
          error: { code: 'server_error', message: 'Upstream generation failed' },
          id: 'resp_failed',
          status: 'failed',
        },
        type: 'response.failed',
      },
      expectedMessage: 'Upstream generation failed',
      expectedTerminalReason: 'response_failed',
      name: 'failed',
    },
    {
      event: {
        response: {
          id: 'resp_incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          status: 'incomplete',
        },
        type: 'response.incomplete',
      },
      expectedMessage: 'Response incomplete: max_output_tokens',
      expectedTerminalReason: 'max_output_tokens',
      name: 'incomplete',
    },
    {
      event: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests',
        param: null,
        type: 'error',
      },
      expectedMessage: 'Too many requests',
      expectedTerminalReason: 'responses_stream_error',
      name: 'explicit error',
    },
  ])(
    'should terminate $name streams as errors without invoking completion',
    async ({ event, expectedMessage, expectedTerminalReason }) => {
      const onCompletion = vi.fn();
      const onError = vi.fn();
      const onFinal = vi.fn();
      const mockOpenAIStream = createReadableStream([
        {
          response: { id: 'resp_terminal_error', status: 'in_progress' },
          type: 'response.created',
        },
        event,
      ]);

      const chunks = await readStreamChunk(
        OpenAIResponsesStream(
          mockOpenAIStream,
          { callbacks: { onCompletion, onError, onFinal } },
          { requireTerminalEvent: true },
        ),
      );
      const streamOutput = chunks.join('');

      expect(streamOutput).toContain('event: error');
      expect(streamOutput).toContain(expectedMessage);
      expect(onCompletion).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Object), {
        terminalReason: expectedTerminalReason,
        terminalSource: 'provider_terminal_event',
      });
      expect(onFinal).toHaveBeenCalledOnce();
    },
  );

  it('should surface refusal deltas as assistant text', async () => {
    const onText = vi.fn();
    const mockOpenAIStream = createReadableStream([
      {
        response: { id: 'resp_refusal', status: 'in_progress' },
        type: 'response.created',
      },
      {
        content_index: 0,
        delta: 'I cannot help with that.',
        item_id: 'msg_refusal',
        output_index: 0,
        type: 'response.refusal.delta',
      },
      {
        response: { id: 'resp_refusal', status: 'completed' },
        type: 'response.completed',
      },
    ]);

    const chunks = await readStreamChunk(
      OpenAIResponsesStream(
        mockOpenAIStream,
        { callbacks: { onText } },
        { requireTerminalEvent: true },
      ),
    );

    expect(chunks.join('')).toContain('I cannot help with that.');
    expect(onText).toHaveBeenCalledWith('I cannot help with that.');
  });

  it('should synthesize an error when a strict stream ends without a terminal event', async () => {
    const onCompletion = vi.fn();
    const onError = vi.fn();
    const onFinal = vi.fn();
    const mockOpenAIStream = createReadableStream([
      {
        response: { id: 'resp_truncated', status: 'in_progress' },
        type: 'response.created',
      },
      {
        delta: 'partial output',
        item_id: 'msg_truncated',
        type: 'response.output_text.delta',
      },
    ]);

    const chunks = await readStreamChunk(
      OpenAIResponsesStream(
        mockOpenAIStream,
        { callbacks: { onCompletion, onError, onFinal } },
        { requireTerminalEvent: true },
      ),
    );
    const streamOutput = chunks.join('');

    expect(streamOutput).toContain('event: error');
    expect(streamOutput).toContain('Stream ended unexpectedly');
    expect(onCompletion).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Object), {
      terminalReason: 'unexpected_end',
      terminalSource: 'missing_terminal_event',
    });
    expect(onFinal).toHaveBeenCalledOnce();
  });

  it('should handle unknown chunk type as data', async () => {
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_unknown',
          status: 'in_progress',
        },
      },
      {
        type: 'response.unknown_event',
        data: 'some data',
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
  });

  it('should handle non-standard item types in output_item.added', async () => {
    // Test the default case in output_item.added when item type is not function_call
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_other_item',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message', // Non-function_call type
          id: 'msg_test',
          status: 'in_progress',
          content: [],
          role: 'assistant',
        },
      },
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toMatchSnapshot();
    expect(chunks.some((c) => c.includes('event: data'))).toBe(true);
  });

  it('should handle chunks with undefined values gracefully', async () => {
    // Test handling of chunks with undefined/missing properties
    const mockOpenAIStream = createReadableStream([
      {
        type: 'response.created',
        response: {
          id: 'resp_undefined_vals',
          status: 'in_progress',
        },
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: undefined,
        delta: undefined,
      } as any,
    ]);

    const protocolStream = OpenAIResponsesStream(mockOpenAIStream);
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('data: "in_progress"');
    expect(chunks.join('')).not.toContain('data: undefined');
    expect(chunks.join('')).not.toContain('id: undefined');
  });

  describe('Reasoning', () => {
    it('summary', async () => {
      const mockOpenAIStream = createReadableStream([
        {
          type: 'response.created',
          response: {
            id: 'resp_684313b89200819087f27686e0c822260b502bf083132d0d',
            object: 'response',
            created_at: 1749226424,
            status: 'in_progress',
            error: null,
            incomplete_details: null,
            instructions: null,
            max_output_tokens: null,
            model: 'o4-mini',
            output: [],
            parallel_tool_calls: true,
            previous_response_id: null,
            reasoning: { effort: 'medium', summary: 'detailed' },
            service_tier: 'auto',
            store: false,
            temperature: 1,
            text: { format: { type: 'text' } },
            tool_choice: 'auto',
            tools: [
              {
                type: 'function',
                description:
                  'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
                name: 'lobe-web-browsing____search____builtin',
                parameters: {
                  properties: {
                    query: { description: 'The search query', type: 'string' },
                    searchCategories: {
                      description: 'The search categories you can set:',
                      items: {
                        enum: ['general', 'images', 'news', 'science', 'videos'],
                        type: 'string',
                      },
                      type: 'array',
                    },
                    searchEngines: {
                      description: 'The search engines you can use:',
                      items: {
                        enum: [
                          'google',
                          'bilibili',
                          'bing',
                          'duckduckgo',
                          'npm',
                          'pypi',
                          'github',
                          'arxiv',
                          'google scholar',
                          'z-library',
                          'reddit',
                          'imdb',
                          'brave',
                          'wikipedia',
                          'pinterest',
                          'unsplash',
                          'vimeo',
                          'youtube',
                        ],
                        type: 'string',
                      },
                      type: 'array',
                    },
                    searchTimeRange: {
                      description: 'The time range you can set:',
                      enum: ['anytime', 'day', 'week', 'month', 'year'],
                      type: 'string',
                    },
                  },
                  required: ['query'],
                  type: 'object',
                },
                strict: true,
              },
              {
                type: 'function',
                description:
                  'A crawler can visit page content. Output is a JSON object of title, content, url and website',
                name: 'lobe-web-browsing____crawlSinglePage____builtin',
                parameters: {
                  properties: {
                    url: { description: 'The url need to be crawled', type: 'string' },
                  },
                  required: ['url'],
                  type: 'object',
                },
                strict: true,
              },
              {
                type: 'function',
                description:
                  'A crawler can visit multi pages. If need to visit multi website, use this one. Output is an array of JSON object of title, content, url and website',
                name: 'lobe-web-browsing____crawlMultiPages____builtin',
                parameters: {
                  properties: {
                    urls: {
                      items: { description: 'The urls need to be crawled', type: 'string' },
                      type: 'array',
                    },
                  },
                  required: ['urls'],
                  type: 'object',
                },
                strict: true,
              },
            ],
            top_p: 1,
            truncation: 'disabled',
            usage: null,
            user: null,
            metadata: {},
          },
        },
        {
          type: 'response.in_progress',
          response: {
            id: 'resp_684313b89200819087f27686e0c822260b502bf083132d0d',
            object: 'response',
            created_at: 1749226424,
            status: 'in_progress',
            error: null,
            incomplete_details: null,
            instructions: null,
            max_output_tokens: null,
            model: 'o4-mini',
            output: [],
            parallel_tool_calls: true,
            previous_response_id: null,
            reasoning: { effort: 'medium', summary: 'detailed' },
            service_tier: 'auto',
            store: false,
            temperature: 1,
            text: { format: { type: 'text' } },
            tool_choice: 'auto',
            tools: [
              {
                type: 'function',
                description:
                  'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
                name: 'lobe-web-browsing____search____builtin',
                parameters: {
                  properties: {
                    query: { description: 'The search query', type: 'string' },
                    searchCategories: {
                      description: 'The search categories you can set:',
                      items: {
                        enum: ['general', 'images', 'news', 'science', 'videos'],
                        type: 'string',
                      },
                      type: 'array',
                    },
                    searchEngines: {
                      description: 'The search engines you can use:',
                      items: {
                        enum: [
                          'google',
                          'bilibili',
                          'bing',
                          'duckduckgo',
                          'npm',
                          'pypi',
                          'github',
                          'arxiv',
                          'google scholar',
                          'z-library',
                          'reddit',
                          'imdb',
                          'brave',
                          'wikipedia',
                          'pinterest',
                          'unsplash',
                          'vimeo',
                          'youtube',
                        ],
                        type: 'string',
                      },
                      type: 'array',
                    },
                    searchTimeRange: {
                      description: 'The time range you can set:',
                      enum: ['anytime', 'day', 'week', 'month', 'year'],
                      type: 'string',
                    },
                  },
                  required: ['query'],
                  type: 'object',
                },
                strict: true,
              },
              {
                type: 'function',
                description:
                  'A crawler can visit page content. Output is a JSON object of title, content, url and website',
                name: 'lobe-web-browsing____crawlSinglePage____builtin',
                parameters: {
                  properties: {
                    url: { description: 'The url need to be crawled', type: 'string' },
                  },
                  required: ['url'],
                  type: 'object',
                },
                strict: true,
              },
              {
                type: 'function',
                description:
                  'A crawler can visit multi pages. If need to visit multi website, use this one. Output is an array of JSON object of title, content, url and website',
                name: 'lobe-web-browsing____crawlMultiPages____builtin',
                parameters: {
                  properties: {
                    urls: {
                      items: { description: 'The urls need to be crawled', type: 'string' },
                      type: 'array',
                    },
                  },
                  required: ['urls'],
                  type: 'object',
                },
                strict: true,
              },
            ],
            top_p: 1,
            truncation: 'disabled',
            usage: null,
            user: null,
            metadata: {},
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
            type: 'reasoning',
            summary: [],
          },
        },
        {
          type: 'response.reasoning_summary_part.added',
          item_id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
          output_index: 0,
          summary_index: 0,
          part: { type: 'summary_text', text: '' },
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
          output_index: 0,
          summary_index: 0,
          delta: '**Answering a',
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
          output_index: 0,
          summary_index: 0,
          delta: ' numeric or 9.92',
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
          output_index: 0,
          summary_index: 0,
          delta: '.',
        },
        {
          type: 'response.reasoning_summary_text.done',
          item_id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
          output_index: 0,
          summary_index: 0,
          text: '**Answering a numeric comparison**\n\nThe user is asking in Chinese which number is larger: 9.1 or 9.92. This is straightforward since 9.92 is clearly larger, as it\'s greater than 9.1. We can respond with "9.92大于9.1" without needing to search for more information. It\'s a simple comparison, but Iould also add a little explanation, noting that 9.92 is indeed 0.82 more than 9.1. However, keeping it simple with "9.92 > 9.1" is perfectly fine!',
        },
        {
          type: 'response.reasoning_summary_part.done',
          item_id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
          output_index: 0,
          summary_index: 0,
          part: {
            type: 'summary_text',
            text: '**Answering a numeric comparison**\n\nThe user is asking in Chinese which number is larger: 9.1 or 9.92. This is straightforward since 9.92 is clearly larger, as it\'s greater than 9.1. We can respond with "9.92大于9.1" without needing to search for more information. Is a simple comparison, but I could also add a little explanation, noting that 9.92 is indeed 0.82 more than 9.1. However, keeping it simple with "9.92 > 9.1" is perfectly fine!',
          },
        },
        {
          type: 'response.reasoning_summary_part.added',
          item_id: 'rs_6843fe13e73c8190a49d9372ef8cd46f08c019075e7c8955',
          output_index: 0,
          summary_index: 1,
          part: { type: 'summary_text', text: '' },
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_6843fe13e73c8190a49d9372ef8cd46f08c019075e7c8955',
          output_index: 0,
          summary_index: 1,
          delta: '**Exploring a mathematical sequence**',
        },
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'rs_6843fe13e73c8190a49d9372ef8cd46f08c019075e7c8955',
          output_index: 0,
          summary_index: 1,
          delta: ' analyzing',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
            type: 'reasoning',
            summary: [
              {
                type: 'summary_text',
                text: '**Answering a numeric comparison**\n\nThe user is asking in Chinese which number is larger: 9.1 or 9.92. This is straightforward since 9.92 is clearly larger, as it\'s greater than 9.1. We can respond with "9.92大于9.1" without needing to search for more information. It\'s simple comparison, but I could also add a little explanation, noting that 9.92 is indeed 0.82 more than 9.1. However, keeping it simple with "9.92 > 9.1" is perfectly fine!',
              },
            ],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
            type: 'message',
            status: 'in_progress',
            content: [],
            role: 'assistant',
          },
        },
        {
          type: 'response.content_part.added',
          item_id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
          output_index: 1,
          content_index: 0,
          part: { type: 'output_text', annotations: [], text: '' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
          output_index: 1,
          content_index: 0,
          delta: '9.92 比 9.1 大。',
        },
        {
          type: 'response.output_text.done',
          item_id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
          output_index: 1,
          content_index: 0,
          text: '9.92 比 9.1 大。',
        },
        {
          type: 'response.content_part.done',
          item_id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
          output_index: 1,
          content_index: 0,
          part: { type: 'output_text', annotations: [], text: '9.92 比 9.1 大。' },
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: {
            id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', annotations: [], text: '9.92 比 9. 大。' }],
            role: 'assistant',
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_684313b89200819087f27686e0c822260b502bf083132d0d',
            object: 'response',
            created_at: 1749226424,
            status: 'completed',
            error: null,
            incomplete_details: null,
            instructions: null,
            max_output_tokens: null,
            model: 'o4-mini',
            output: [
              {
                id: 'rs_684313b9774481908ee856625f82fb8c0b502bf083132d0d',
                type: 'reasoning',
                summary: [
                  {
                    type: 'summary_text',
                    text: '**Answering a numeric comparison**\n\nThe user is asking in Chinese which number is larger: 9.1 or 9.92. This is straightforward since 9.92 is clearly larger, as it\'s greater than 9.1. We can respond with "9.92大于9.1" without needing to search for more information. It\'s a simplcomparison, but I could also add a little explanation, noting that 9.92 is indeed 0.82 more than 9.1. However, keeping it simple with "9.92 > 9.1" is perfectly fine!',
                  },
                ],
              },
              {
                id: 'msg_684313bee2c88190b0f4b09621ad7dc60b502bf083132d0d',
                type: 'message',
                status: 'completed',
                content: [{ type: 'output_text', annotations: [], text: '9.92 比 9.1 大。' }],
                role: 'assistant',
              },
            ],
            parallel_tool_calls: true,
            previous_response_id: null,
            reasoning: { effort: 'medium', summary: 'detailed' },
            service_tier: 'default',
            store: false,
            temperature: 1,
            text: { format: { type: 'text' } },
            tool_choice: 'auto',
            tools: [
              {
                type: 'function',
                description:
                  'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
                name: 'lobe-web-browsing____search____builtin',
                parameters: {
                  properties: {
                    query: { description: 'The search query', type: 'string' },
                    searchCategories: {
                      description: 'The search categories you can set:',
                      items: {
                        enum: ['general', 'images', 'news', 'science', 'videos'],
                        type: 'string',
                      },
                      type: 'array',
                    },
                    searchEngines: {
                      description: 'The search engines you can use:',
                      items: {
                        enum: [
                          'google',
                          'bilibili',
                          'bing',
                          'duckduckgo',
                          'npm',
                          'pypi',
                          'github',
                          'arxiv',
                          'google scholar',
                          'z-library',
                          'reddit',
                          'imdb',
                          'brave',
                          'wikipedia',
                          'pinterest',
                          'unsplash',
                          'vimeo',
                          'youtube',
                        ],
                        type: 'string',
                      },
                      type: 'array',
                    },
                    searchTimeRange: {
                      description: 'The time range you can set:',
                      enum: ['anytime', 'day', 'week', 'month', 'year'],
                      type: 'string',
                    },
                  },
                  required: ['query'],
                  type: 'object',
                },
                strict: true,
              },
              {
                type: 'function',
                description:
                  'A crawler can visit page content. Output is a JSON object of title, content, url and website',
                name: 'lobe-web-browsing____crawlSinglePage____builtin',
                parameters: {
                  properties: {
                    url: { description: 'The url need to be crawled', type: 'string' },
                  },
                  required: ['url'],
                  type: 'object',
                },
                strict: true,
              },
              {
                type: 'function',
                description:
                  'A crawler can visit multi pages. If need to visit multi website, use this one. Output is an array of JSON object of title, content, url and website',
                name: 'lobe-web-browsing____crawlMultiPages____builtin',
                parameters: {
                  properties: {
                    urls: {
                      items: { description: 'The urls need to be crawled', type: 'string' },
                      type: 'array',
                    },
                  },
                  required: ['urls'],
                  type: 'object',
                },
                strict: true,
              },
            ],
            top_p: 1,
            truncation: 'disabled',
            usage: {
              input_tokens: 2391,
              input_tokens_details: { cached_tokens: 2298 },
              output_tokens: 144,
              output_tokens_details: { reasoning_tokens: 128 },
              total_tokens: 2535,
            },
            user: null,
            metadata: {},
          },
        },
      ]);

      const onStartMock = vi.fn();
      const onTextMock = vi.fn();
      const onCompletionMock = vi.fn();

      const protocolStream = OpenAIResponsesStream(mockOpenAIStream, {
        callbacks: {
          onStart: onStartMock,
          onText: onTextMock,
          onCompletion: onCompletionMock,
        },
      });

      const chunks = await readStreamChunk(protocolStream);

      expect(chunks).toMatchSnapshot();

      expect(onStartMock).toHaveBeenCalledTimes(1);
      expect(onCompletionMock).toHaveBeenCalledTimes(1);
    });
  });
});
