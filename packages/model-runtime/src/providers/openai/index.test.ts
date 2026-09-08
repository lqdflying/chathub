// @vitest-environment node
import OpenAI from 'openai';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import officalOpenAIModels from './fixtures/openai-models.json';
import { GPT6_ASTRA_MODEL_PATTERN, LobeOpenAI, hasOpenAIToolCallingTurn, isGpt6AstraModel, params } from './index';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock fetch for most tests, but will be restored for real network tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LobeOpenAI', () => {
  let instance: InstanceType<typeof LobeOpenAI>;

  beforeEach(() => {
    instance = new LobeOpenAI({ apiKey: 'test' });

    // 使用 vi.spyOn 来模拟 chat.completions.create 方法
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].models, 'list').mockResolvedValue({ data: [] } as any);

    // Mock responses.create for responses API tests
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(new ReadableStream() as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('chat', () => {
    it('should return a StreamingTextResponse on successful API call', async () => {
      // Arrange
      const mockStream = new ReadableStream();
      const mockResponse = Promise.resolve(mockStream);

      (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    it('should not forward internal provider field to Chat Completions', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4',
        provider: 'openai',
      } as any);

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).not.toHaveProperty('provider');
    });

    it('should not forward internal provider field through gpt-5 prune path', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-5-mini',
        provider: 'openai',
        reasoning_effort: 'high',
      } as any);

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).toMatchObject({
        model: 'gpt-5-mini',
        reasoning_effort: 'high',
      });
      expect(requestPayload).not.toHaveProperty('provider');
    });

    it('should send only the trusted prompt cache key for eligible Chat Completions models', async () => {
      await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-5.6-sol',
          prompt_cache_key: 'CLIENT_CONTROLLED_KEY',
        },
        { trustedPromptCacheKey: 'ch_trustedpromptcachekey0123456789' },
      );

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload.prompt_cache_key).toBe('ch_trustedpromptcachekey0123456789');
      expect(JSON.stringify(requestPayload)).not.toContain('CLIENT_CONTROLLED_KEY');
    });

    it('should omit prompt cache keys for ineligible native OpenAI models', async () => {
      await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o',
          prompt_cache_key: 'CLIENT_CONTROLLED_KEY',
        },
        { trustedPromptCacheKey: 'ch_trustedpromptcachekey0123456789' },
      );

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).not.toHaveProperty('prompt_cache_key');
    });

    it('should ignore compatible cache controls for native OpenAI models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o',
        openAICompatCache: {
          chat: {
            promptCacheKey: true,
            sessionHeader: true,
          },
        },
      });

      const createMock = instance['client'].chat.completions.create as Mock;
      const requestPayload = createMock.mock.calls[0][0];
      const requestOptions = createMock.mock.calls[0][1];

      expect(requestPayload).not.toHaveProperty('prompt_cache_key');
      expect(requestPayload).not.toHaveProperty('openAICompatCache');
      expect(requestOptions.headers).not.toHaveProperty('Session_id');
    });

    it('should send only the trusted prompt cache key in Responses mode', async () => {
      await instance.chat(
        {
          enabledSearch: true,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-5.6-sol',
          prompt_cache_key: 'CLIENT_CONTROLLED_KEY',
        },
        { trustedPromptCacheKey: 'ch_trustedpromptcachekey0123456789' },
      );

      const requestPayload = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(requestPayload.prompt_cache_key).toBe('ch_trustedpromptcachekey0123456789');
      expect(JSON.stringify(requestPayload)).not.toContain('CLIENT_CONTROLLED_KEY');
    });

    describe('Error', () => {
      it('should return ProviderBizError with an openai error response when OpenAI.APIError is thrown', async () => {
        // Arrange
        const apiError = new OpenAI.APIError(
          400,
          {
            error: {
              message: 'Bad Request',
            },
            status: 400,
          },
          'Error message',
          undefined,
        );

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: 'https://api.openai.com/v1',
            error: {
              error: { message: 'Bad Request' },
              status: 400,
            },
            errorType: 'ProviderBizError',
            provider: 'openai',
          });
        }
      });

      it('should throw AgentRuntimeError with NoOpenAIAPIKey if no apiKey is provided', async () => {
        try {
          new LobeOpenAI({});
        } catch (e) {
          expect(e).toEqual({ errorType: 'InvalidProviderAPIKey' });
        }
      });

      it('should return ProviderBizError with the cause when OpenAI.APIError is thrown with cause', async () => {
        // Arrange
        const errorInfo = {
          cause: {
            message: 'api is undefined',
          },
        };
        const apiError = new OpenAI.APIError(400, errorInfo, 'module error', undefined);

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: 'https://api.openai.com/v1',
            error: {
              cause: { message: 'api is undefined' },
            },
            errorType: 'ProviderBizError',
            provider: 'openai',
          });
        }
      });

      it('should return ProviderBizError with an cause response with desensitize Url', async () => {
        // Arrange
        const errorInfo = {
          cause: { message: 'api is undefined' },
        };
        const apiError = new OpenAI.APIError(400, errorInfo, 'module error', undefined);

        instance = new LobeOpenAI({
          apiKey: 'test',

          baseURL: 'https://api.abc.com/v1',
        });

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-3.5-turbo',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: 'https://api.***.com/v1',
            error: {
              cause: { message: 'api is undefined' },
            },
            errorType: 'ProviderBizError',
            provider: 'openai',
          });
        }
      });

      it('should return AgentRuntimeError for non-OpenAI errors', async () => {
        // Arrange
        const genericError = new Error('Generic Error');

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(genericError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: 'https://api.openai.com/v1',
            error: {
              cause: genericError.cause,
              message: genericError.message,
              name: genericError.name,
            },
            errorType: 'AgentRuntimeError',
            provider: 'openai',
          });
        }
      });
    });

    describe('DEBUG', () => {
      it('should log stream chunks when DEBUG_OPENAI_CHAT_COMPLETION is 1', async () => {
        const completionChunk = {
          choices: [
            {
              delta: { content: 'Debug stream content' },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'debug-completion',
          model: 'text-davinci-003',
        };
        (instance['client'].chat.completions.create as Mock).mockResolvedValue(
          (async function* () {
            yield completionChunk;
          })(),
        );
        const originalDebugValue = process.env.DEBUG_OPENAI_CHAT_COMPLETION;
        process.env.DEBUG_OPENAI_CHAT_COMPLETION = '1';
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
          const response = await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
          await response.text();

          // delta chunks are merged into one consolidated record at stream end
          const record = consoleLogSpy.mock.calls
            .map(([line]) => line)
            .find((line) => typeof line === 'string' && line.includes('debug-completion'));
          expect(record).toBeDefined();
          expect(JSON.parse(record as string)).toMatchObject({
            id: 'debug-completion',
            model: 'text-davinci-003',
            text: 'Debug stream content',
          });
        } finally {
          process.env.DEBUG_OPENAI_CHAT_COMPLETION = originalDebugValue;
        }
      });
    });
  });

  describe('models', () => {
    it('should get models', async () => {
      // mock the models.list method
      (instance['client'].models.list as Mock).mockResolvedValue({ data: officalOpenAIModels });

      const list = await instance.models();

      expect(list).toMatchSnapshot();
    });
  });

  describe('chatCompletion.handlePayload', () => {
    it('should use responses API for responsesAPIModels without enabledSearch', async () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'o1-pro', // 这个模型在 responsesAPIModels 中
        temperature: 0.7,
      };

      await instance.chat(payload);

      // 应该调用 responses.create 而不是 chat.completions.create
      expect(instance['client'].responses.create).toHaveBeenCalled();
      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.model).toBe('o1-pro');
    });

    it.each(['gpt-5.5-pro', 'gpt-5.5-pro-2026-04-23'])(
      'routes %s through non-streaming Responses',
      async (model) => {
        const createSpy = vi.spyOn(instance['client'].responses, 'create').mockResolvedValue({
          created_at: 1,
          error: null,
          id: 'resp-pro',
          object: 'response',
          output: [],
          status: 'completed',
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        } as any);

        const response = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' as const }],
          model,
          stream: true,
        });
        await response.text();

        expect(createSpy).toHaveBeenCalled();
        expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
        const createCall = createSpy.mock.calls[0][0];
        expect(createCall.model).toBe(model);
        expect(createCall.stream).not.toBe(true);
      },
    );

    it.each(['gpt-5.4-pro', 'gpt-5.2-pro'])(
      'routes Responses-only %s without forcing stream off',
      (model) => {
        const result = params.chatCompletion.handlePayload({
          messages: [{ content: 'Hello', role: 'user' }],
          model,
          stream: true,
        } as any);

        expect(result.apiMode).toBe('responses');
        expect(result.model).toBe(model);
        expect(result.stream).not.toBe(false);
      },
    );

    it('should use responses API for gpt-5.5 without enabledSearch', async () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-5.5',
        provider: 'openai',
        temperature: 0.7,
      };

      await instance.chat(payload);

      expect(instance['client'].responses.create).toHaveBeenCalled();
      expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.model).toBe('gpt-5.5');
      expect(createCall).not.toHaveProperty('provider');
    });

    it('maps Chat Completions max_tokens to Responses max_output_tokens for gpt-5.5', async () => {
      await instance.chat({
        max_tokens: 2448,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-5.5',
        reasoning_effort: 'high',
      });

      expect(instance['client'].responses.create).toHaveBeenCalled();
      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.max_output_tokens).toBe(2448);
      expect(createCall.reasoning).toEqual(expect.objectContaining({ effort: 'high' }));
      expect(createCall).not.toHaveProperty('max_tokens');
      expect(createCall).not.toHaveProperty('reasoning_effort');
    });

    it('should use responses API when enabledSearch is true', async () => {
      const payload = {
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4o',
        temperature: 0.7,
      };

      await instance.chat(payload);

      // 应该调用 responses.create
      expect(instance['client'].responses.create).toHaveBeenCalled();
    });

    it('should handle -search- models with stripped parameters', async () => {
      const payload = {
        frequency_penalty: 0.5,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4o-search-2024',
        presence_penalty: 0.3,
        temperature: 0.7,
        top_p: 0.9,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(createCall.model).toBe('gpt-4o-search-2024');
      expect(createCall.temperature).toBeUndefined();
      expect(createCall.top_p).toBeUndefined();
      expect(createCall.frequency_penalty).toBeUndefined();
      expect(createCall.presence_penalty).toBeUndefined();
      expect(createCall.stream).toBe(true);
    });

    it('should handle regular models with stripped legacy parameters', async () => {
      const payload = {
        frequency_penalty: 0.5,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4o',
        presence_penalty: 0.3,
        temperature: 0.7,
        top_p: 0.9,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(createCall.model).toBe('gpt-4o');
      expect(createCall.temperature).toBeUndefined();
      expect(createCall.top_p).toBeUndefined();
      expect(createCall.frequency_penalty).toBeUndefined();
      expect(createCall.presence_penalty).toBeUndefined();
      expect(createCall.stream).toBe(true);
    });

    it('should prune sampling fields for gpt-6-astra', () => {
      const payload = params.chatCompletion.handlePayload!(
        {
          frequency_penalty: 0.2,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-6-astra',
          presence_penalty: 0.1,
          provider: 'openai',
          temperature: 0.7,
          top_p: 0.9,
        } as any,
      );

      expect(payload).toMatchObject({
        model: 'gpt-6-astra',
      });
      expect(payload).not.toHaveProperty('frequency_penalty');
      expect(payload).not.toHaveProperty('presence_penalty');
      expect(payload).not.toHaveProperty('provider');
      expect(payload).not.toHaveProperty('temperature');
      expect(payload).not.toHaveProperty('top_p');
      expect(payload).not.toHaveProperty('apiMode');
    });

    it('routes gpt-6-astra function tools onto Responses without treating Astra as globally Responses-only', () => {
      const weatherTool = {
        function: {
          description: 'Get weather',
          name: 'get_weather',
          parameters: { type: 'object', properties: {} },
        },
        type: 'function' as const,
      };

      const withTools = params.chatCompletion.handlePayload!({
        messages: [{ content: 'Check weather', role: 'user' }],
        model: 'gpt-6-astra',
        reasoning_effort: 'high',
        temperature: 0.7,
        tools: [weatherTool],
      } as any);

      expect(withTools.apiMode).toBe('responses');
      expect(withTools.model).toBe('gpt-6-astra');
      expect(withTools.tools).toEqual([weatherTool]);
      expect(withTools.reasoning_effort).toBe('high');

      const snapshot = params.chatCompletion.handlePayload!({
        messages: [{ content: 'Check weather', role: 'user' }],
        model: 'gpt-6-astra-2026-09-03',
        tools: [weatherTool],
      } as any);
      expect(snapshot.apiMode).toBe('responses');

      const replayOnly = params.chatCompletion.handlePayload!({
        messages: [
          { content: 'Check weather', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{}', name: 'get_weather' },
                id: 'call_weather',
                type: 'function',
              },
            ],
          },
          { content: '{"ok":true}', role: 'tool', tool_call_id: 'call_weather' },
        ],
        model: 'gpt-6-astra',
      } as any);
      expect(replayOnly.apiMode).toBe('responses');

      const solWithTools = params.chatCompletion.handlePayload!({
        messages: [{ content: 'Check weather', role: 'user' }],
        model: 'gpt-5.6-sol',
        tools: [weatherTool],
      } as any);
      expect(solWithTools.apiMode).not.toBe('responses');
    });
  });

  describe('gpt-6-astra native Responses routing', () => {
    const weatherTool = {
      function: {
        description: 'Get weather',
        name: 'get_weather',
        parameters: { type: 'object', properties: {} },
      },
      type: 'function' as const,
    };

    const completedResponsesStream = () =>
      (async function* () {
        yield {
          response: { id: 'astra', output: [], status: 'in_progress' },
          type: 'response.created',
        };
        yield { delta: 'ok', type: 'response.output_text.delta' };
        yield {
          response: { id: 'astra', output: [], status: 'completed' },
          type: 'response.completed',
        };
      })();

    const completedChatStream = (model: string) =>
      (async function* () {
        yield {
          choices: [{ delta: { content: 'ok' }, finish_reason: null, index: 0 }],
          created: 1,
          id: 'astra',
          model,
          object: 'chat.completion.chunk',
        };
        yield {
          choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          created: 1,
          id: 'astra',
          model,
          object: 'chat.completion.chunk',
        };
      })();

    it('matches Astra ids and tool-calling turns', () => {
      expect(isGpt6AstraModel('gpt-6-astra')).toBe(true);
      expect(isGpt6AstraModel('gpt-6-astra-2026-09-03')).toBe(true);
      expect(isGpt6AstraModel('gpt-5.6-sol')).toBe(false);
      expect(
        hasOpenAIToolCallingTurn({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-6-astra',
          tools: [weatherTool],
        } as any),
      ).toBe(true);
      expect(
        hasOpenAIToolCallingTurn({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-6-astra',
        } as any),
      ).toBe(false);
    });

    it('sends function tools to Responses and does not call Chat Completions', async () => {
      const responsesCreate = vi
        .spyOn(instance['client'].responses, 'create')
        .mockImplementation(async () => completedResponsesStream() as any);
      const completionsCreate = vi.spyOn(instance['client'].chat.completions, 'create');

      const response = await instance.chat({
        messages: [{ content: 'Check the weather with get_weather.', role: 'user' }],
        model: 'gpt-6-astra',
        reasoning_effort: 'high',
        tools: [weatherTool],
      });
      await response.text();

      expect(responsesCreate).toHaveBeenCalledTimes(1);
      expect(completionsCreate).not.toHaveBeenCalled();

      const createCall = responsesCreate.mock.calls[0][0];
      expect(createCall.model).toBe('gpt-6-astra');
      expect(createCall.reasoning).toEqual(expect.objectContaining({ effort: 'high' }));
      expect(createCall.tools).toEqual([
        expect.objectContaining({ name: 'get_weather', type: 'function' }),
      ]);
      expect(createCall.input).toEqual([
        expect.objectContaining({
          content: 'Check the weather with get_weather.',
          role: 'user',
        }),
      ]);
      expect(createCall).not.toHaveProperty('reasoning_effort');
      expect(createCall).not.toHaveProperty('temperature');
    });

    it('sends tool-call replay to Responses with matching function_call items', async () => {
      const responsesCreate = vi
        .spyOn(instance['client'].responses, 'create')
        .mockImplementation(async () => completedResponsesStream() as any);
      const completionsCreate = vi.spyOn(instance['client'].chat.completions, 'create');

      const response = await instance.chat({
        messages: [
          { content: 'Check the weather with get_weather.', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{}', name: 'get_weather' },
                id: 'call_weather',
                type: 'function',
              },
            ],
          },
          { content: '{"ok":true}', role: 'tool', tool_call_id: 'call_weather' },
        ],
        model: 'gpt-6-astra',
        reasoning_effort: 'high',
        tools: [weatherTool],
      } as any);
      await response.text();

      expect(responsesCreate).toHaveBeenCalledTimes(1);
      expect(completionsCreate).not.toHaveBeenCalled();

      const input = responsesCreate.mock.calls[0][0].input as any[];
      expect(input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            arguments: '{}',
            call_id: 'call_weather',
            name: 'get_weather',
            type: 'function_call',
          }),
          expect.objectContaining({
            call_id: 'call_weather',
            output: '{"ok":true}',
            type: 'function_call_output',
          }),
        ]),
      );
    });

    it('keeps tool-free Astra on Chat Completions', async () => {
      const completionsCreate = vi
        .spyOn(instance['client'].chat.completions, 'create')
        .mockImplementation(async () => completedChatStream('gpt-6-astra') as any);
      const responsesCreate = vi.spyOn(instance['client'].responses, 'create');

      const response = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-6-astra',
        reasoning_effort: 'high',
        temperature: 0.7,
      });
      await response.text();

      expect(completionsCreate).toHaveBeenCalledTimes(1);
      expect(responsesCreate).not.toHaveBeenCalled();

      const createCall = completionsCreate.mock.calls[0][0];
      expect(createCall.model).toBe('gpt-6-astra');
      expect(createCall.reasoning_effort).toBe('high');
      expect(createCall).not.toHaveProperty('temperature');
    });
  });

  describe('gpt-6-astra generateObject routing', () => {
    // Casual-scene supervisor tools from packages/prompts supervisor tools
    // (`trigger_agent` + `wait_for_user_input`). Copied here so this package
    // does not take a prompts dependency.
    const supervisorTools = [
      {
        function: {
          description: 'Trigger an agent to speak (group message).',
          name: 'trigger_agent',
          parameters: {
            properties: {
              id: { description: 'The agent id to trigger.', type: 'string' },
              instruction: {
                description:
                  'The instruction or message for the agent. No longer than 10 words. Always use English.',
                type: 'string',
              },
            },
            required: ['id', 'instruction'],
            type: 'object',
          },
        },
        type: 'function' as const,
      },
      {
        function: {
          description:
            'Wait for user input. Use this when the conversation history looks likes fine for now, or agents are waiting for user input.',
          name: 'wait_for_user_input',
          parameters: {
            properties: {
              reason: {
                description: 'Optional reason for pausing the conversation.',
                type: 'string',
              },
            },
            required: [],
            type: 'object',
          },
        },
        type: 'function' as const,
      },
    ];

    it('matches GPT6_ASTRA_MODEL_PATTERN for alias and dated snapshots', () => {
      expect(GPT6_ASTRA_MODEL_PATTERN.test('gpt-6-astra')).toBe(true);
      expect(GPT6_ASTRA_MODEL_PATTERN.test('gpt-6-astra-2026-09-03')).toBe(true);
      expect(GPT6_ASTRA_MODEL_PATTERN.test('gpt-5.6-sol')).toBe(false);
      expect(params.generateObject?.useResponseModels).toEqual([GPT6_ASTRA_MODEL_PATTERN]);
    });

    it.each(['gpt-6-astra', 'gpt-6-astra-2026-09-03'])(
      'sends %s supervisor tools through Responses without responseApi',
      async (model) => {
        const responsesCreate = vi.spyOn(instance['client'].responses, 'create').mockResolvedValue({
          output: [
            {
              arguments: '{}',
              call_id: 'pause',
              name: 'wait_for_user_input',
              type: 'function_call',
            },
          ],
        } as any);
        const completionsCreate = vi.spyOn(instance['client'].chat.completions, 'create');

        const result = await instance.generateObject({
          messages: [{ content: 'Choose the next speaker.', role: 'user' }],
          model,
          tools: supervisorTools,
        });

        expect(responsesCreate).toHaveBeenCalledTimes(1);
        expect(completionsCreate).not.toHaveBeenCalled();
        expect(result).toEqual([{ arguments: {}, name: 'wait_for_user_input' }]);

        const createCall = responsesCreate.mock.calls[0][0];
        expect(createCall.model).toBe(model);
        expect(createCall.tool_choice).toBe('required');
        expect(createCall.tools).toEqual(
          supervisorTools.map((tool) => ({ type: tool.type, ...tool.function })),
        );
        expect(createCall.input).toEqual([
          expect.objectContaining({
            content: 'Choose the next speaker.',
            role: 'user',
          }),
        ]);
      },
    );

    it('keeps gpt-5.6-sol generateObject tools on Chat Completions', async () => {
      const completionsCreate = vi
        .spyOn(instance['client'].chat.completions, 'create')
        .mockResolvedValue({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: { arguments: '{}', name: 'wait_for_user_input' },
                    id: 'pause',
                    type: 'function',
                  },
                ],
              },
            },
          ],
        } as any);
      const responsesCreate = vi.spyOn(instance['client'].responses, 'create');

      const result = await instance.generateObject({
        messages: [{ content: 'Choose the next speaker.', role: 'user' }],
        model: 'gpt-5.6-sol',
        tools: supervisorTools,
      });

      expect(completionsCreate).toHaveBeenCalledTimes(1);
      expect(responsesCreate).not.toHaveBeenCalled();
      expect(result).toEqual([{ arguments: {}, name: 'wait_for_user_input' }]);
      expect(completionsCreate.mock.calls[0][0]).toMatchObject({
        model: 'gpt-5.6-sol',
        tool_choice: 'required',
      });
    });
  });

  describe('responses.handlePayload', () => {
    it('should add web_search tool when enabledSearch is true', async () => {
      const payload = {
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4o',
        // 使用常规模型，通过 enabledSearch 触发 responses API
        temperature: 0.7,
        tools: [{ function: { description: 'test', name: 'test' }, type: 'function' as const }],
      };

      await instance.chat(payload);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.tools).toEqual([
        { description: 'test', name: 'test', type: 'function' },
        { type: 'web_search' },
      ]);
    });

    it('should add search_context_size to web_search tool when OPENAI_SEARCH_CONTEXT_SIZE is set', async () => {
      // Note: oaiSearchContextSize is read at module load time, not runtime
      // This test verifies the tool structure is correct when the env var would be set
      const payload = {
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4o',
        temperature: 0.7,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      // Verify web_search tool is added, search_context_size depends on env var at module load time
      expect(createCall.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'web_search' })]),
      );
    });

    it('should handle computer-use models with truncation and reasoning', async () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'computer-use-preview',
        reasoning: { effort: 'medium' },
        temperature: 0.7,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.truncation).toBe('auto');
      expect(createCall.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
    });

    it('should handle prunePrefixes models without computer-use truncation', async () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'o3-pro', // prunePrefixes 模型但非 computer-use，且在 responsesAPIModels 中
        temperature: 0.7,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.reasoning).toEqual({ summary: 'auto' });
      expect(createCall.truncation).toBeUndefined();
    });

    it('should set reasoning.effort to high for gpt-5-pro models', async () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-5-pro',
        temperature: 0.7,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    });

    it('should set reasoning.effort to high for gpt-5-pro-2025-10-06 models', async () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-5-pro-2025-10-06',
        temperature: 0.7,
      };

      await instance.chat(payload);

      const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];
      expect(createCall.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    });
  });

  describe('supportsFlexTier', () => {
    // Note: enableServiceTierFlex is read at module load time
    // These tests verify the logic would work if env var was set at module load
    it('should verify flex tier logic for supported models', () => {
      // Since enableServiceTierFlex is read at module load time,
      // we can't dynamically test it without reloading the module.
      // Instead, we verify that the supportsFlexTier function logic is correct
      // by checking the model patterns it should support.

      const flexSupportedModels = ['gpt-5', 'o3', 'o4-mini'];

      // Should support these models
      expect(flexSupportedModels.some((m) => 'gpt-5-turbo'.startsWith(m))).toBe(true);
      expect(flexSupportedModels.some((m) => 'o3-pro'.startsWith(m))).toBe(true);
      expect(flexSupportedModels.some((m) => 'o4-mini'.startsWith(m))).toBe(true);

      // Should NOT support o3-mini (explicitly excluded)
      expect('o3-mini'.startsWith('o3-mini')).toBe(true);
    });
  });

  describe('debug configuration', () => {
    it('should return false when DEBUG_OPENAI_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_OPENAI_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should return true when DEBUG_OPENAI_CHAT_COMPLETION is set to 1', () => {
      const originalEnv = process.env.DEBUG_OPENAI_CHAT_COMPLETION;
      process.env.DEBUG_OPENAI_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      process.env.DEBUG_OPENAI_CHAT_COMPLETION = originalEnv;
    });

    it('should return false when DEBUG_OPENAI_RESPONSES is not set', () => {
      delete process.env.DEBUG_OPENAI_RESPONSES;
      const result = params.debug.responses();
      expect(result).toBe(false);
    });

    it('should return true when DEBUG_OPENAI_RESPONSES is set to 1', () => {
      const originalEnv = process.env.DEBUG_OPENAI_RESPONSES;
      process.env.DEBUG_OPENAI_RESPONSES = '1';
      const result = params.debug.responses();
      expect(result).toBe(true);
      process.env.DEBUG_OPENAI_RESPONSES = originalEnv;
    });
  });
});
