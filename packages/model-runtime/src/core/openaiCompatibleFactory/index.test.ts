// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import type {
  ModelCacheDiagnosticContext,
  ModelCacheDiagnosticEvent,
} from '../../types/cacheDiagnostics';
import { ChatStreamCallbacks, ChatStreamPayload } from '../../types/chat';
import { AgentRuntimeErrorType } from '../../types/error';
import { SSE_HEARTBEAT_COMMENT } from '../../utils/response';
import * as openaiHelpers from '../contextBuilders/openai';
import { createOpenAICompatibleRuntime } from './index';

const sleep = async (ms: number) =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const provider = 'groq';
const defaultBaseURL = 'https://api.groq.com/openai/v1';
const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

const createCacheDiagnosticContext = (
  providerId: string,
): { context: ModelCacheDiagnosticContext; events: ModelCacheDiagnosticEvent[] } => {
  const events: ModelCacheDiagnosticEvent[] = [];
  const context: ModelCacheDiagnosticContext = {
    emit: (event) => events.push(event),
    fingerprint: (scope) => `${scope}-fingerprint`,
    provider: providerId,
    runtimeFamily: 'openai-compatible',
  };

  return { context, events };
};

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

const LobeMockProvider = createOpenAICompatibleRuntime({
  baseURL: defaultBaseURL,
  chatCompletion: {
    handleError: (error) => {
      // 403 means the location is not supporteds
      if (error.status === 403)
        return { error, errorType: AgentRuntimeErrorType.LocationNotSupportError };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MOCKPROVIDER_CHAT_COMPLETION === '1',
  },
  provider,
});

beforeEach(() => {
  instance = new LobeMockProvider({ apiKey: 'test' });

  // Use vi.spyOn to mock the chat.completions.create method
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeOpenAICompatibleFactory', () => {
  // Polyfill File for Node environment used in image tests
  if (typeof File === 'undefined') {
    // @ts-ignore
    global.File = class MockFile {
      constructor(
        public parts: any[],
        public name: string,
        public opts?: any,
      ) {}
    };
  }

  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const instance = new LobeMockProvider({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeMockProvider);
      expect(instance.baseURL).toEqual(defaultBaseURL);
    });
  });

  describe('chat', () => {
    it('should return a Response on successful API call', async () => {
      // Arrange
      const mockStream = new ReadableStream();
      const mockResponse = Promise.resolve(mockStream);

      (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    it('should call chat API with corresponding options', async () => {
      // Arrange
      const mockStream = new ReadableStream();
      const mockResponse = Promise.resolve(mockStream);

      (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        max_tokens: 1024,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0.7,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        {
          max_tokens: 1024,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'mistralai/mistral-7b-instruct:free',
          stream: true,
          stream_options: {
            include_usage: true,
          },
          temperature: 0.7,
          top_p: 1,
          user: undefined,
        },
        {
          headers: { Accept: '*/*' },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should send configured Chat Completions cache hints for OpenAI-compatible payloads', async () => {
      const mockStream = new ReadableStream();
      const mockCreateMethod = vi
        .spyOn(instance['client'].chat.completions, 'create')
        .mockResolvedValue(mockStream as any);

      await instance.chat({
        messages: [
          { content: 'Keep the response brief.', role: 'system' },
          { content: 'Hello', role: 'user' },
        ],
        model: 'gpt-5-mini',
        openAICompatCache: {
          chat: {
            promptCacheKey: true,
            sessionHeader: true,
          },
        },
        temperature: 0,
      });

      const requestPayload = mockCreateMethod.mock.calls[0][0] as any;
      const requestOptions = mockCreateMethod.mock.calls[0][1] as any;

      expect(requestPayload.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
      expect(requestPayload).not.toHaveProperty('openAICompatCache');
      expect(requestOptions.headers.Session_id).toBe(requestPayload.prompt_cache_key);
    });

    it('should preserve unobservable cache support without leaking internal metadata upstream', async () => {
      const LobeUnobservableProvider = createOpenAICompatibleRuntime({
        baseURL: 'https://api.test.com/v1',
        cacheSupport: 'unobservable',
        provider: 'unobservable-provider',
      });
      const unobservableInstance = new LobeUnobservableProvider({ apiKey: 'test' });
      const mockResponse = {
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
            message: { content: 'Hello', role: 'assistant' },
          },
        ],
        created: 123,
        id: 'response-id',
        model: 'private-model-id',
        object: 'chat.completion',
        usage: {
          completion_tokens: 5,
          prompt_tokens: 10,
          total_tokens: 15,
        },
      } as OpenAI.ChatCompletion;
      const createSpy = vi
        .spyOn(unobservableInstance['client'].chat.completions, 'create')
        .mockResolvedValue(mockResponse);
      const events: ModelCacheDiagnosticEvent[] = [];
      const cacheDiagnostics: ModelCacheDiagnosticContext = {
        emit: (event) => events.push(event),
        fingerprint: (scope) => `${scope}-fingerprint`,
        provider: 'unobservable-provider',
        runtimeFamily: 'openai-compatible',
        toolCache: {
          inputItemCount: 1,
          toolCallCount: 1,
          toolCallSetHash: '0123456789abcdef',
          toolResults: [],
        },
      };

      const response = await unobservableInstance.chat(
        {
          debugToolCache: cacheDiagnostics.toolCache,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'private-model-id',
          stream: false,
        },
        { cacheDiagnostics },
      );
      await response.text();

      expect(createSpy.mock.calls[0][0]).not.toHaveProperty('debugToolCache');
      expect(events).toEqual([
        expect.objectContaining({
          cacheSupport: 'unobservable',
          type: 'request',
        }),
        expect.objectContaining({
          cacheStatus: 'not_reported',
          cacheSupport: 'unobservable',
          type: 'usage',
        }),
      ]);
    });

    it('should not fall back to legacy cache logging when diagnostics are disabled', async () => {
      const DisabledDiagnosticsProvider = createOpenAICompatibleRuntime({
        baseURL: defaultBaseURL,
        provider: 'openaicompatible',
      });
      const disabledDiagnosticsInstance = new DisabledDiagnosticsProvider({ apiKey: 'test' });
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const originalDebugValue = process.env.DEBUG_OPENAICOMPATIBLE_CACHE;
      process.env.DEBUG_OPENAICOMPATIBLE_CACHE = '1';

      vi.spyOn(disabledDiagnosticsInstance['client'].chat.completions, 'create').mockResolvedValue({
        choices: [],
        created: 123,
        id: 'private-response-id',
        model: 'private-model-id',
        object: 'chat.completion',
        usage: {
          completion_tokens: 1,
          prompt_tokens: 1,
          total_tokens: 2,
        },
      } as any);

      try {
        await disabledDiagnosticsInstance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'private-model-id',
            stream: false,
          },
          { cacheDiagnosticsDisabled: true },
        );

        expect(consoleLogSpy).not.toHaveBeenCalledWith(
          '[openai-compatible-cache-debug:request]',
          expect.anything(),
        );
        expect(consoleLogSpy).not.toHaveBeenCalledWith(
          '[openai-compatible-cache-debug:usage]',
          expect.anything(),
        );
      } finally {
        consoleLogSpy.mockRestore();
        if (originalDebugValue === undefined) delete process.env.DEBUG_OPENAICOMPATIBLE_CACHE;
        else process.env.DEBUG_OPENAICOMPATIBLE_CACHE = originalDebugValue;
      }
    });

    it('should emit terminal diagnostics for non-streaming request rejection', async () => {
      const { context, events } = createCacheDiagnosticContext(provider);
      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(
        new Error('PRIVATE_UPSTREAM_FAILURE'),
      );

      await expect(
        instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'private-model-id',
            stream: false,
          },
          { cacheDiagnostics: context },
        ),
      ).rejects.toBeDefined();

      expect(events.map((event) => event.type)).toEqual(['request', 'terminal_error']);
      expect(JSON.stringify(events)).not.toContain('PRIVATE_UPSTREAM_FAILURE');
    });

    it('should finalize Chat Completions JSON diagnostics from normalized usage', async () => {
      const { context, events } = createCacheDiagnosticContext(provider);
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
        choices: [],
        created: 123,
        id: 'private-response-id',
        model: 'private-model-id',
        object: 'chat.completion',
        usage: {
          completion_tokens: 5,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
          prompt_tokens: 100,
          total_tokens: 105,
        },
      } as any);

      const response = await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'private-model-id',
          responseMode: 'json',
          stream: false,
        },
        { cacheDiagnostics: context },
      );
      await response.json();

      expect(events).toEqual([
        expect.objectContaining({ type: 'request' }),
        expect.objectContaining({
          cacheStatus: 'mixed',
          type: 'usage',
          usage: expect.objectContaining({
            inputCacheMissTokens: 20,
            inputCachedTokens: 80,
          }),
        }),
      ]);
    });

    it('should finalize non-streaming Chat Completions diagnostics before body consumption', async () => {
      const { context, events } = createCacheDiagnosticContext(provider);
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
        choices: [],
        created: 123,
        id: 'private-response-id',
        model: 'private-model-id',
        object: 'chat.completion',
        usage: {
          completion_tokens: 5,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
          prompt_tokens: 100,
          total_tokens: 105,
        },
      } as any);

      await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'private-model-id',
          stream: false,
        },
        { cacheDiagnostics: context },
      );

      expect(events.map((event) => event.type)).toEqual(['request', 'usage']);
    });

    it('should preserve parent-owned repeated tool results stored out of order', async () => {
      const createSpy = vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
        choices: [],
        created: 123,
        id: 'private-response-id',
        model: 'private-model-id',
        object: 'chat.completion',
        usage: {
          completion_tokens: 1,
          prompt_tokens: 1,
          total_tokens: 2,
        },
      } as any);
      const repeatedToolCall = {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:7',
        type: 'function' as const,
      };

      await instance.chat({
        messages: [
          {
            content: 'second result',
            id: 'tool-2',
            parentId: 'assistant-2',
            role: 'tool',
            tool_call_id: repeatedToolCall.id,
          },
          {
            content: null,
            id: 'assistant-1',
            role: 'assistant',
            tool_calls: [repeatedToolCall],
          },
          {
            content: 'first result',
            id: 'tool-1',
            parentId: 'assistant-1',
            role: 'tool',
            tool_call_id: repeatedToolCall.id,
          },
          {
            content: null,
            id: 'assistant-2',
            role: 'assistant',
            tool_calls: [repeatedToolCall],
          },
        ] as any,
        model: 'private-model-id',
        responseMode: 'json',
        stream: false,
      });

      const requestMessages = createSpy.mock.calls[0][0].messages as any[];
      expect(requestMessages.map((message) => message.content)).toEqual([
        null,
        'first result',
        null,
        'second result',
      ]);
      expect(requestMessages.every((message) => !('id' in message))).toBe(true);
      expect(requestMessages.every((message) => !('parentId' in message))).toBe(true);
    });

    it('should pass repaired messages and initialized diagnostics to custom clients', async () => {
      const createChatCompletionStream = vi.fn(() => new ReadableStream());
      const CustomClientRuntime = createOpenAICompatibleRuntime({
        baseURL: 'https://api.test.com/v1',
        customClient: { createChatCompletionStream },
        provider,
      });
      const customClientInstance = new CustomClientRuntime({ apiKey: 'test' });
      const { context, events } = createCacheDiagnosticContext(provider);
      const repeatedToolCall = {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:7',
        type: 'function' as const,
      };

      await customClientInstance.chat(
        {
          messages: [
            {
              content: 'second result',
              id: 'tool-2',
              parentId: 'assistant-2',
              role: 'tool',
              tool_call_id: repeatedToolCall.id,
            },
            {
              content: null,
              id: 'assistant-1',
              role: 'assistant',
              tool_calls: [repeatedToolCall],
            },
            {
              content: 'first result',
              id: 'tool-1',
              parentId: 'assistant-1',
              role: 'tool',
              tool_call_id: repeatedToolCall.id,
            },
            {
              content: null,
              id: 'assistant-2',
              role: 'assistant',
              tool_calls: [repeatedToolCall],
            },
          ] as any,
          model: 'private-model-id',
          stream: true,
        },
        { cacheDiagnostics: context },
      );

      const customPayload = createChatCompletionStream.mock.calls[0][1] as ChatStreamPayload;
      expect(customPayload.messages.map((message) => message.content)).toEqual([
        null,
        'first result',
        null,
        'second result',
      ]);
      expect(customPayload.messages.every((message) => !('id' in message))).toBe(true);
      expect(customPayload.messages.every((message) => !('parentId' in message))).toBe(true);
      expect(events.map((event) => event.type)).toEqual(['request']);
    });

    describe('streaming response', () => {
      it('should handle multiple data chunks correctly', async () => {
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              choices: [
                { delta: { content: 'hello' }, finish_reason: null, index: 0, logprobs: null },
              ],
              created: 1_709_125_675,
              id: 'a',
              model: 'mistralai/mistral-7b-instruct:free',
              object: 'chat.completion.chunk',
              system_fingerprint: 'fp_86156a94a0',
            });
            controller.close();
          },
        });
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockStream as any,
        );

        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'mistralai/mistral-7b-instruct:free',
          temperature: 0,
        });

        const decoder = new TextDecoder();
        const reader = result.body!.getReader();

        // Collect all chunks
        const chunks = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value));
        }
        // Assert that all expected chunk patterns are present
        expect(chunks).toEqual([SSE_HEARTBEAT_COMMENT, 'id: a\nevent: text\ndata: "hello"\n\n']);
      });

      // https://github.com/lobehub/lobe-chat/issues/2752
      it('should handle burn hair data chunks correctly', async () => {
        const chunks = [
          {
            choices: [],
            created: 0,
            id: '',
            model: '',
            object: '',
            prompt_filter_results: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                prompt_index: 0,
              },
            ],
          },
          {
            choices: [
              {
                delta: { content: '', role: 'assistant' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1_717_249_403,
            id: 'chatcmpl-9VJIxA3qNM2C2YdAnNYA2KgDYfFnX',
            model: 'gpt-4o-2024-05-13',
            object: 'chat.completion.chunk',
            system_fingerprint: 'fp_5f4bad809a',
          },
          {
            choices: [{ delta: { content: '1' }, finish_reason: null, index: 0, logprobs: null }],
            created: 1_717_249_403,
            id: 'chatcmpl-9VJIxA3qNM2C2YdAnNYA2KgDYfFnX',
            model: 'gpt-4o-2024-05-13',
            object: 'chat.completion.chunk',
            system_fingerprint: 'fp_5f4bad809a',
          },
          {
            choices: [{ delta: {}, finish_reason: 'stop', index: 0, logprobs: null }],
            created: 1_717_249_403,
            id: 'chatcmpl-9VJIxA3qNM2C2YdAnNYA2KgDYfFnX',
            model: 'gpt-4o-2024-05-13',
            object: 'chat.completion.chunk',
            system_fingerprint: 'fp_5f4bad809a',
          },
          {
            choices: [
              {
                content_filter_offsets: { check_offset: 35, end_offset: 36, start_offset: 35 },
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                finish_reason: null,
                index: 0,
              },
            ],
            created: 0,
            id: '',
            model: '',
            object: '',
          },
        ];
        const mockStream = new ReadableStream({
          start(controller) {
            chunks.forEach((item) => {
              controller.enqueue(item);
            });

            controller.close();
          },
        });
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockStream as any,
        );

        const stream: string[] = [];
        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-3.5-turbo',
          temperature: 0,
        });
        const decoder = new TextDecoder();
        const reader = result.body!.getReader();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          stream.push(decoder.decode(value));
        }

        expect(stream).toEqual([
          SSE_HEARTBEAT_COMMENT,
          'id: \nevent: data\ndata: {"choices":[],"created":0,"id":"","model":"","object":"","prompt_filter_results":[{"content_filter_results":{"hate":{"filtered":false,"severity":"safe"},"self_harm":{"filtered":false,"severity":"safe"},"sexual":{"filtered":false,"severity":"safe"},"violence":{"filtered":false,"severity":"safe"}},"prompt_index":0}]}\n\n',
          'id: chatcmpl-9VJIxA3qNM2C2YdAnNYA2KgDYfFnX\nevent: text\ndata: ""\n\n',
          'id: chatcmpl-9VJIxA3qNM2C2YdAnNYA2KgDYfFnX\nevent: text\ndata: "1"\n\n',
          'id: chatcmpl-9VJIxA3qNM2C2YdAnNYA2KgDYfFnX\nevent: stop\ndata: "stop"\n\n',
          'id: \nevent: data\ndata: {"id":"","index":0}\n\n',
        ]);
      });

      it('should transform non-streaming response to stream correctly', async () => {
        vi.useFakeTimers();

        const mockResponse = {
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
              message: { content: 'Hello', role: 'assistant' },
            },
          ],
          created: 123,
          id: 'a',
          model: 'mistralai/mistral-7b-instruct:free',
          object: 'chat.completion',
          usage: {
            completion_tokens: 5,
            prompt_tokens: 5,
            total_tokens: 10,
          },
        } as OpenAI.ChatCompletion;
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const chatPromise = instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'mistralai/mistral-7b-instruct:free',
          stream: false,
          temperature: 0,
        });

        // Advance time to simulate processing delay
        vi.advanceTimersByTime(10);

        const result = await chatPromise;

        const decoder = new TextDecoder();
        const reader = result.body!.getReader();
        const stream: string[] = [];

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          stream.push(decoder.decode(value));
        }

        expect(stream).toEqual([
          'id: a\n',
          'event: text\n',
          'data: "Hello"\n\n',
          'id: a\n',
          'event: usage\n',
          'data: {"inputTextTokens":5,"outputTextTokens":5,"totalInputTokens":5,"totalOutputTokens":5,"totalTokens":10}\n\n',
          'id: output_speed\n',
          'event: speed\n',
          expect.stringMatching(/^data: {.*"tps":.*,"ttft":.*}\n\n$/), // tps ttft should be calculated with elapsed time
          'id: a\n',
          'event: stop\n',
          'data: "stop"\n\n',
        ]);

        const finalRead = await reader.read();
        expect(finalRead.done).toBe(true);

        vi.useRealTimers();
      });

      it('should transform non-streaming response to stream correctly with reasoning content', async () => {
        vi.useFakeTimers();

        const mockResponse = {
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
              message: {
                content: 'Hello',
                reasoning_content: 'Thinking content',
                role: 'assistant',
              },
            },
          ],
          created: 123,
          id: 'a',
          model: 'deepseek/deepseek-reasoner',
          object: 'chat.completion',
          usage: {
            completion_tokens: 5,
            prompt_tokens: 5,
            total_tokens: 10,
          },
        } as unknown as OpenAI.ChatCompletion;
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const chatPromise = instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'deepseek/deepseek-reasoner',
          stream: false,
          temperature: 0,
        });

        // Advance time to simulate processing delay
        vi.advanceTimersByTime(10);

        const result = await chatPromise;

        const decoder = new TextDecoder();
        const reader = result.body!.getReader();
        const stream: string[] = [];

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          stream.push(decoder.decode(value));
        }

        expect(stream).toEqual([
          'id: a\n',
          'event: reasoning\n',
          'data: "Thinking content"\n\n',
          'id: a\n',
          'event: text\n',
          'data: "Hello"\n\n',
          'id: a\n',
          'event: usage\n',
          'data: {"inputTextTokens":5,"outputTextTokens":5,"totalInputTokens":5,"totalOutputTokens":5,"totalTokens":10}\n\n',
          'id: output_speed\n',
          'event: speed\n',
          expect.stringMatching(/^data: {.*"tps":.*,"ttft":.*}\n\n$/), // tps ttft should be calculated with elapsed time
          'id: a\n',
          'event: stop\n',
          'data: "stop"\n\n',
        ]);

        const finalRead = await reader.read();
        expect(finalRead.done).toBe(true);

        vi.useRealTimers();
      });
    });

    describe('handlePayload option', () => {
      it('should add user in payload correctly', async () => {
        const mockCreateMethod = vi.spyOn(instance['client'].chat.completions, 'create');

        await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          },
          { user: 'abc' },
        );

        expect(mockCreateMethod).toHaveBeenCalledWith(
          expect.objectContaining({
            user: 'abc',
          }),
          expect.anything(),
        );
      });
    });

    describe('noUserId option', () => {
      it('should not add user to payload when noUserId is true', async () => {
        const LobeMockProvider = createOpenAICompatibleRuntime({
          baseURL: 'https://api.mistral.ai/v1',
          chatCompletion: {
            noUserId: true,
          },
          provider: ModelProvider.Mistral,
        });

        const instance = new LobeMockProvider({ apiKey: 'test' });
        const mockCreateMethod = vi
          .spyOn(instance['client'].chat.completions, 'create')
          .mockResolvedValue(new ReadableStream() as any);

        await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'open-mistral-7b',
            temperature: 0,
          },
          { user: 'testUser' },
        );

        expect(mockCreateMethod).toHaveBeenCalledWith(
          expect.not.objectContaining({
            user: 'testUser',
          }),
          expect.anything(),
        );
      });

      it('should add user to payload when noUserId is false', async () => {
        const LobeMockProvider = createOpenAICompatibleRuntime({
          baseURL: 'https://api.mistral.ai/v1',
          chatCompletion: {
            noUserId: false,
          },
          provider: ModelProvider.Mistral,
        });

        const instance = new LobeMockProvider({ apiKey: 'test' });
        const mockCreateMethod = vi
          .spyOn(instance['client'].chat.completions, 'create')
          .mockResolvedValue(new ReadableStream() as any);

        await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'open-mistral-7b',
            temperature: 0,
          },
          { user: 'testUser' },
        );

        expect(mockCreateMethod).toHaveBeenCalledWith(
          expect.objectContaining({
            user: 'testUser',
          }),
          expect.anything(),
        );
      });

      it('should add user to payload when noUserId is not set in chatCompletion', async () => {
        const LobeMockProvider = createOpenAICompatibleRuntime({
          baseURL: 'https://api.mistral.ai/v1',
          provider: ModelProvider.Mistral,
        });

        const instance = new LobeMockProvider({ apiKey: 'test' });
        const mockCreateMethod = vi
          .spyOn(instance['client'].chat.completions, 'create')
          .mockResolvedValue(new ReadableStream() as any);

        await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'open-mistral-7b',
            temperature: 0,
          },
          { user: 'testUser' },
        );

        expect(mockCreateMethod).toHaveBeenCalledWith(
          expect.objectContaining({
            user: 'testUser',
          }),
          expect.anything(),
        );
      });
    });

    describe('cancel request', () => {
      it('should cancel ongoing request correctly', async () => {
        const controller = new AbortController();
        let upstreamSignal: AbortSignal | undefined;
        const mockCreateMethod = vi
          .spyOn(instance['client'].chat.completions, 'create')
          .mockImplementation((_payload, options) => {
            upstreamSignal = options?.signal;
            return new Promise((_, reject) => {
              upstreamSignal?.addEventListener(
                'abort',
                () => reject(new DOMException('The user aborted a request.', 'AbortError')),
                { once: true },
              );
            }) as any;
          });

        const response = await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          },
          { signal: controller.signal },
        );

        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe(SSE_HEARTBEAT_COMMENT);

        controller.abort();

        let streamedError = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamedError += new TextDecoder().decode(value);
        }

        expect(upstreamSignal?.aborted).toBe(true);
        expect(streamedError).toContain('event: error');
        expect(streamedError).toContain('AgentRuntimeError');
        expect(streamedError).toContain('The user aborted a request.');
        expect(mockCreateMethod).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            signal: expect.any(AbortSignal),
          }),
        );
      });
    });

    describe('Error', () => {
      it('should return bizErrorType with an openai error response when OpenAI.APIError is thrown', async () => {
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
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: defaultBaseURL,
            error: {
              error: { message: 'Bad Request' },
              status: 400,
            },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should throw AgentRuntimeError with invalidErrorType if no apiKey is provided', async () => {
        try {
          new LobeMockProvider({});
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType });
        }
      });

      it('should return bizErrorType with the cause when OpenAI.APIError is thrown with cause', async () => {
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
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: defaultBaseURL,
            error: {
              cause: { message: 'api is undefined' },
            },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should return bizErrorType with an cause response with desensitize Url', async () => {
        // Arrange
        const errorInfo = {
          cause: { message: 'api is undefined' },
        };
        const apiError = new OpenAI.APIError(400, errorInfo, 'module error', undefined);

        instance = new LobeMockProvider({
          apiKey: 'test',

          baseURL: 'https://api.abc.com/v1',
        });

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: 'https://api.***.com/v1',
            error: {
              cause: { message: 'api is undefined' },
            },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      describe('handleError option', () => {
        it('should return correct error type for 403 status code', async () => {
          const error = { status: 403 };
          vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

          try {
            await instance.chat({
              messages: [{ content: 'Hello', role: 'user' }],
              model: 'mistralai/mistral-7b-instruct:free',
              temperature: 0,
            });
          } catch (e) {
            expect(e).toEqual({
              error,
              errorType: AgentRuntimeErrorType.LocationNotSupportError,
              provider,
            });
          }
        });
      });

      it('should throw an InvalidOpenRouterAPIKey error type on 401 status code', async () => {
        // Mock the API call to simulate a 401 error
        const error = new Error('Unauthorized') as any;
        error.status = 401;
        vi.mocked(instance['client'].chat.completions.create).mockRejectedValue(error);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });
        } catch (e) {
          // Expect the chat method to throw an error with InvalidMoonshotAPIKey
          expect(e).toMatchObject({
            endpoint: defaultBaseURL,
            error,
            errorType: invalidErrorType,
            provider,
          });
        }
      });

      it('should return InsufficientQuota error when error message contains "Insufficient Balance"', async () => {
        const apiError = new OpenAI.APIError(
          400,
          {
            error: {
              message: 'Insufficient Balance: Your account balance is too low',
            },
            status: 400,
          },
          'Error message',
          undefined,
        );

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: defaultBaseURL,
            error: {
              error: { message: 'Insufficient Balance: Your account balance is too low' },
              status: 400,
            },
            errorType: AgentRuntimeErrorType.InsufficientQuota,
            provider,
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
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            endpoint: defaultBaseURL,
            error: {
              cause: genericError.cause,
              message: genericError.message,
              name: genericError.name,
            },
            errorType: 'AgentRuntimeError',
            provider,
          });
        }
      });
    });

    describe('chat with callback and headers', () => {
      it('should handle callback and headers correctly', async () => {
        // Mock chat.completions.create method to return a readable stream
        const mockCreateMethod = vi
          .spyOn(instance['client'].chat.completions, 'create')
          .mockResolvedValue(
            new ReadableStream({
              start(controller) {
                controller.enqueue({
                  choices: [
                    { delta: { content: 'hello' }, finish_reason: null, index: 0, logprobs: null },
                  ],
                  created: 1_709_125_675,
                  id: 'chatcmpl-8xDx5AETP8mESQN7UB30GxTN2H1SO',
                  model: 'mistralai/mistral-7b-instruct:free',
                  object: 'chat.completion.chunk',
                  system_fingerprint: 'fp_86156a94a0',
                });
                controller.close();
              },
            }) as any,
          );

        // Prepare callback and headers
        const mockCallback: ChatStreamCallbacks = {
          onCompletion: vi.fn(),
          onStart: vi.fn(),
        };
        const mockHeaders = { 'Custom-Header': 'TestValue' };

        // Execute test
        const result = await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          },
          { callback: mockCallback, headers: mockHeaders },
        );

        // Verify callback is called
        await result.text(); // Ensure stream is consumed
        expect(mockCallback.onStart).toHaveBeenCalled();
        expect(mockCallback.onCompletion).toHaveBeenCalledWith({
          text: 'hello',
        });

        // Verify headers are correctly passed
        expect(result.headers.get('Custom-Header')).toEqual('TestValue');

        // Cleanup
        mockCreateMethod.mockRestore();
      });
    });

    it('should use custom stream handler when provided', async () => {
      // Create a custom stream handler that handles both ReadableStream and OpenAI Stream
      const customStreamHandler = vi.fn(
        (stream: ReadableStream | Stream<OpenAI.ChatCompletionChunk>) => {
          const readableStream =
            stream instanceof ReadableStream ? stream : stream.toReadableStream();
          return new ReadableStream({
            start(controller) {
              const reader = readableStream.getReader();
              const process = async () => {
                try {
                  // eslint-disable-next-line no-constant-condition
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    controller.enqueue(value);
                  }
                } finally {
                  controller.close();
                }
              };
              process();
            },
          });
        },
      );

      const LobeMockProvider = createOpenAICompatibleRuntime({
        baseURL: 'https://api.test.com/v1',
        chatCompletion: {
          handleStream: customStreamHandler,
        },
        provider: ModelProvider.OpenAI,
      });

      const instance = new LobeMockProvider({ apiKey: 'test' });

      // Create a mock stream
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            choices: [{ delta: { content: 'Hello' }, index: 0 }],
            created: Date.now(),
            id: 'test-id',
            model: 'test-model',
            object: 'chat.completion.chunk',
          });
          controller.close();
        },
      });

      // The factory now passes the SDK response directly to handleStream
      // (no Stream.tee()), so the mock must return the stream itself.
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(mockStream as any);

      const payload: ChatStreamPayload = {
        messages: [{ content: 'Test', role: 'user' }],
        model: 'test-model',
        temperature: 0.7,
      };

      await instance.chat(payload);

      expect(customStreamHandler).toHaveBeenCalled();
    });

    it('should use custom transform handler for non-streaming response', async () => {
      const customTransformHandler = vi.fn((data: OpenAI.ChatCompletion): ReadableStream => {
        return new ReadableStream({
          start(controller) {
            // Transform the completion to chunk format
            controller.enqueue({
              choices: data.choices.map((choice) => ({
                delta: { content: choice.message.content },
                index: choice.index,
              })),
              created: data.created,
              id: data.id,
              model: data.model,
              object: 'chat.completion.chunk',
            });
            controller.close();
          },
        });
      });

      const LobeMockProvider = createOpenAICompatibleRuntime({
        baseURL: 'https://api.test.com/v1',
        chatCompletion: {
          handleTransformResponseToStream: customTransformHandler,
        },
        provider: ModelProvider.OpenAI,
      });

      const instance = new LobeMockProvider({ apiKey: 'test' });

      const mockResponse: OpenAI.ChatCompletion = {
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
            message: {
              content: 'Test response',
              refusal: null,
              role: 'assistant',
            },
          },
        ],
        created: Date.now(),
        id: 'test-id',
        model: 'test-model',
        object: 'chat.completion',
        usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
      };

      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
        mockResponse as any,
      );

      const payload: ChatStreamPayload = {
        messages: [{ content: 'Test', role: 'user' }],
        model: 'test-model',
        stream: false,
        temperature: 0.7,
      };

      await instance.chat(payload);

      expect(customTransformHandler).toHaveBeenCalledWith(mockResponse);
    });

    describe('responses routing', () => {
      it('should emit one terminal diagnostic and abort upstream on consumer cancellation', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const { context, events } = createCacheDiagnosticContext(ModelProvider.OpenAI);
        const onCancel = vi.fn();
        let upstreamSignal: AbortSignal | undefined;
        vi.spyOn(inst['client'].responses, 'create').mockImplementation((_payload, options) => {
          upstreamSignal = options?.signal;
          return new Promise(() => undefined) as any;
        });

        const response = await inst.chat(
          {
            messages: [{ content: 'continue after tools', role: 'user' }],
            model: 'gpt-5.6-sol',
            stream: true,
          },
          { cacheDiagnostics: context, callback: { onCancel } },
        );
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel('consumer_cancelled');

        await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
        expect(onCancel).toHaveBeenCalledWith('consumer_cancelled');
        expect(events.map((event) => event.type)).toEqual(['request', 'terminal_error']);
      });

      it('should emit terminal diagnostics for non-streaming Responses request rejection', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const { context, events } = createCacheDiagnosticContext(ModelProvider.OpenAI);
        vi.spyOn(inst['client'].responses, 'create').mockRejectedValue(
          new Error('PRIVATE_RESPONSES_FAILURE'),
        );

        await expect(
          inst.chat(
            {
              messages: [{ content: 'Hello', role: 'user' }],
              model: 'gpt-5.6-sol',
              stream: false,
            },
            { cacheDiagnostics: context },
          ),
        ).rejects.toBeDefined();

        expect(events.map((event) => event.type)).toEqual(['request', 'terminal_error']);
        expect(JSON.stringify(events)).not.toContain('PRIVATE_RESPONSES_FAILURE');
      });

      it('should finalize Responses JSON diagnostics from normalized usage', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const { context, events } = createCacheDiagnosticContext(ModelProvider.OpenAI);
        vi.spyOn(inst['client'].responses, 'create').mockResolvedValue({
          created_at: 123,
          error: null,
          id: 'private-response-id',
          incomplete_details: null,
          instructions: null,
          max_output_tokens: null,
          metadata: {},
          model: 'private-model-id',
          object: 'response',
          output: [],
          parallel_tool_calls: true,
          previous_response_id: null,
          reasoning: null,
          status: 'completed',
          temperature: null,
          text: { format: { type: 'text' } },
          tool_choice: 'auto',
          tools: [],
          top_p: null,
          truncation: 'disabled',
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 80 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 105,
          },
          user: null,
        } as any);

        const response = await inst.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-5.6-sol',
            responseMode: 'json',
            stream: false,
          },
          { cacheDiagnostics: context },
        );
        await response.json();

        expect(events).toEqual([
          expect.objectContaining({ type: 'request' }),
          expect.objectContaining({
            cacheStatus: 'mixed',
            type: 'usage',
            usage: expect.objectContaining({
              inputCacheMissTokens: 20,
              inputCachedTokens: 80,
            }),
          }),
        ]);
      });

      it('should finalize non-streaming Responses diagnostics before body consumption', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const { context, events } = createCacheDiagnosticContext(ModelProvider.OpenAI);
        vi.spyOn(inst['client'].responses, 'create').mockResolvedValue({
          created_at: 123,
          error: null,
          id: 'private-response-id',
          incomplete_details: null,
          instructions: null,
          max_output_tokens: null,
          metadata: {},
          model: 'private-model-id',
          object: 'response',
          output: [],
          parallel_tool_calls: true,
          previous_response_id: null,
          reasoning: null,
          status: 'completed',
          temperature: null,
          text: { format: { type: 'text' } },
          tool_choice: 'auto',
          tools: [],
          top_p: null,
          truncation: 'disabled',
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 80 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 105,
          },
          user: null,
        } as any);

        await inst.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-5.6-sol',
            stream: false,
          },
          { cacheDiagnostics: context },
        );

        expect(events.map((event) => event.type)).toEqual(['request', 'usage']);
      });

      it('should repair repeated tool rounds before converting Responses input', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const createSpy = vi.spyOn(inst['client'].responses, 'create').mockResolvedValue({
          created_at: 123,
          error: null,
          id: 'private-response-id',
          incomplete_details: null,
          instructions: null,
          max_output_tokens: null,
          metadata: {},
          model: 'gpt-5.6-sol',
          object: 'response',
          output: [],
          parallel_tool_calls: true,
          previous_response_id: null,
          reasoning: null,
          status: 'completed',
          temperature: null,
          text: { format: { type: 'text' } },
          tool_choice: 'auto',
          tools: [],
          top_p: null,
          truncation: 'disabled',
          usage: null,
          user: null,
        } as any);
        const repeatedToolCall = {
          function: { arguments: '{}', name: 'tavily_search' },
          id: 'tavily____tavily_search____mcp:7',
          type: 'function' as const,
        };

        await inst.chat({
          messages: [
            {
              content: 'second result',
              id: 'tool-2',
              parentId: 'assistant-2',
              role: 'tool',
              tool_call_id: repeatedToolCall.id,
            },
            {
              content: null,
              id: 'assistant-1',
              role: 'assistant',
              tool_calls: [repeatedToolCall],
            },
            {
              content: 'first result',
              id: 'tool-1',
              parentId: 'assistant-1',
              role: 'tool',
              tool_call_id: repeatedToolCall.id,
            },
            {
              content: null,
              id: 'assistant-2',
              role: 'assistant',
              tool_calls: [repeatedToolCall],
            },
          ] as any,
          model: 'gpt-5.6-sol',
          responseMode: 'json',
          stream: false,
        });

        const responseInput = createSpy.mock.calls[0][0].input as any[];
        expect(responseInput.map((item) => item.type)).toEqual([
          'function_call',
          'function_call_output',
          'function_call',
          'function_call_output',
        ]);
        expect(responseInput.filter((item) => item.type === 'function_call_output')).toEqual([
          expect.objectContaining({ output: 'first result' }),
          expect.objectContaining({ output: 'second result' }),
        ]);
      });

      it('returns an SSE heartbeat before a pending Responses handshake completes', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        let upstreamSignal: AbortSignal | undefined;
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockImplementation((_payload, options) => {
            upstreamSignal = options?.signal;
            return new Promise(() => undefined) as any;
          });

        const response = await inst.chat({
          messages: [{ content: 'continue after tools', role: 'user' }],
          model: 'gpt-5.6-sol',
          stream: true,
          temperature: 0,
        });
        const reader = response.body!.getReader();

        expect(new TextDecoder().decode((await reader.read()).value)).toBe(SSE_HEARTBEAT_COMMENT);
        expect(mockResponsesCreate).toHaveBeenCalledTimes(1);

        await reader.cancel('test complete');
        await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
      });

      it('should route to Responses API when chatCompletion.useResponse is true', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAI,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });

        // mock responses.create to return a stream-like with tee
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'any-model',
          temperature: 0,
        });

        expect(mockResponsesCreate).toHaveBeenCalled();
      });

      it('should keep built-in search and role-valid assistant history in Responses follow-ups', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAI,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [
            { content: 'Search the web for Tavily MCP.', role: 'user' },
            {
              content: [{ text: 'I found the latest Tavily MCP docs.', type: 'text' }],
              role: 'assistant',
            } as any,
            { content: 'What should we do next?', role: 'user' },
          ],
          model: 'gpt-5-mini',
          stream: true,
          temperature: 0,
          tools: [
            {
              type: 'web_search' as any,
            } as any,
          ],
        });

        const requestPayload = mockResponsesCreate.mock.calls[0][0] as any;

        expect(requestPayload.tools).toEqual([{ type: 'web_search' }]);
        expect(requestPayload.input).toEqual([
          { content: 'Search the web for Tavily MCP.', role: 'user' },
          { content: 'I found the latest Tavily MCP docs.', role: 'assistant' },
          { content: 'What should we do next?', role: 'user' },
        ]);
        const assistantItems = requestPayload.input.filter(
          (item: any) => item.role === 'assistant',
        );
        expect(assistantItems).toHaveLength(1);
        expect(assistantItems[0].content).toBe('I found the latest Tavily MCP docs.');
        expect(JSON.stringify(assistantItems)).not.toContain('"input_text"');
      });

      it('should keep Responses API stateless unless response state is explicitly enabled', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAI,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-5-mini',
          temperature: 0,
        });

        expect(mockResponsesCreate).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
        expect(mockResponsesCreate.mock.calls[0][0]).not.toHaveProperty('prompt_cache_key');
        expect(mockResponsesCreate.mock.calls[0][0]).not.toHaveProperty('responseStateMode');
        expect(mockResponsesCreate.mock.calls[0][0]).not.toHaveProperty('store');
      });

      it('should enable Responses state and derive prompt_cache_key when explicitly configured', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAICompatible,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [
            { content: 'Keep the response brief.', role: 'system' },
            { content: 'hi', role: 'user' },
          ],
          model: 'gpt-5-mini',
          responseStateMode: 'provider',
          temperature: 0,
        });

        expect(mockResponsesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt_cache_key: expect.stringMatching(/^compat_cc_[a-f0-9]{32}$/),
            store: true,
          }),
          expect.any(Object),
        );
        expect(mockResponsesCreate.mock.calls[0][0]).not.toHaveProperty('responseStateMode');
      });

      it('should send configured Responses cache hints without leaking internal config', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAICompatible,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [
            { content: 'Keep the response brief.', role: 'system' },
            { content: 'hi', role: 'user' },
          ],
          model: 'gpt-5-mini',
          openAICompatCache: {
            responses: {
              promptCacheKey: 'derived',
              sessionHeader: true,
              store: 'false',
            },
          },
          responseStateMode: 'provider',
          temperature: 0,
        });

        const requestPayload = mockResponsesCreate.mock.calls[0][0] as any;
        const requestOptions = mockResponsesCreate.mock.calls[0][1] as any;

        expect(requestPayload.prompt_cache_key).toMatch(/^compat_cc_[a-f0-9]{32}$/);
        expect(requestPayload.store).toBe(false);
        expect(requestPayload).not.toHaveProperty('openAICompatCache');
        expect(requestPayload).not.toHaveProperty('responseStateMode');
        expect(requestOptions.headers.Session_id).toBe(requestPayload.prompt_cache_key);
      });

      it('should allow Responses Session_id without sending prompt_cache_key', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAICompatible,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [
            { content: 'Keep the response brief.', role: 'system' },
            { content: 'hi', role: 'user' },
          ],
          model: 'gpt-5-mini',
          openAICompatCache: {
            responses: {
              promptCacheKey: 'off',
              sessionHeader: true,
              store: 'default',
            },
          },
          temperature: 0,
        });

        const requestPayload = mockResponsesCreate.mock.calls[0][0] as any;
        const requestOptions = mockResponsesCreate.mock.calls[0][1] as any;

        expect(requestPayload).not.toHaveProperty('prompt_cache_key');
        expect(requestPayload).not.toHaveProperty('store');
        expect(requestOptions.headers.Session_id).toMatch(/^compat_cc_[a-f0-9]{32}$/);
      });

      it('always maps reasoning effort to nested reasoning.effort and preserves reasoning options', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponse: true,
          },
          provider: ModelProvider.OpenAI,
        });

        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const prod = new ReadableStream();
        const debug = new ReadableStream();
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockResolvedValue({ tee: () => [prod, debug] } as any);

        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-5.6-sol',
          openAICompatResponsesParams: { reasoningEffort: 'top-level' } as any,
          reasoning: { summary: 'auto' },
          reasoning_effort: 'high',
          temperature: 0,
        });

        const requestPayload = mockResponsesCreate.mock.calls[0][0] as any;

        expect(requestPayload.reasoning).toEqual({ effort: 'high', summary: 'auto' });
        expect(requestPayload).not.toHaveProperty('reasoning_effort');
        expect(requestPayload).not.toHaveProperty('openAICompatResponsesParams');
      });

      it('derives Responses cache identity from effective reasoning and tools', async () => {
        const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: { useResponse: true },
          provider: ModelProvider.OpenAICompatible,
        });
        const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
        const mockResponsesCreate = vi
          .spyOn(inst['client'].responses, 'create')
          .mockImplementation(async () => {
            return {
              tee: () => [new ReadableStream(), new ReadableStream()],
            } as any;
          });
        const cache = {
          responses: {
            promptCacheKey: 'derived' as const,
            sessionHeader: false,
            store: 'true' as const,
          },
        };
        const tool = (description: string) => ({
          function: { description, name: 'lookup', parameters: { type: 'object' } },
          type: 'function' as const,
        });

        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-5.6-sol',
          openAICompatCache: cache,
          reasoning_effort: 'low',
          temperature: 0,
          tools: [tool('first schema')],
        });
        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-5.6-sol',
          openAICompatCache: cache,
          reasoning_effort: 'high',
          temperature: 0,
          tools: [tool('first schema')],
        });
        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-5.6-sol',
          openAICompatCache: cache,
          reasoning_effort: 'high',
          temperature: 0,
          tools: [tool('changed schema')],
        });

        const keys = mockResponsesCreate.mock.calls.map(([request]) =>
          String((request as any).prompt_cache_key),
        );
        expect(keys[0]).not.toBe(keys[1]);
        expect(keys[1]).not.toBe(keys[2]);
      });

      it('should route to Responses API when model matches useResponseModels', async () => {
        const LobeMockProviderUseResponseModels = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com/v1',
          chatCompletion: {
            useResponseModels: ['special-model', /special-\w+/],
          },
          provider: ModelProvider.OpenAI,
        });
        const inst = new LobeMockProviderUseResponseModels({ apiKey: 'test' });
        const spy = vi.spyOn(inst['client'].responses, 'create');
        // Prevent hanging by mocking normal chat completion stream
        vi.spyOn(inst['client'].chat.completions, 'create').mockResolvedValue(
          new ReadableStream() as any,
        );

        // First invocation: model contains the string
        spy.mockResolvedValueOnce({
          tee: () => [new ReadableStream(), new ReadableStream()],
        } as any);
        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'prefix-special-model-suffix',
          temperature: 0,
        });
        expect(spy).toHaveBeenCalledTimes(1);

        // Second invocation: model matches the RegExp
        spy.mockResolvedValueOnce({
          tee: () => [new ReadableStream(), new ReadableStream()],
        } as any);
        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'special-xyz',
          temperature: 0,
        });
        expect(spy).toHaveBeenCalledTimes(2);

        // Third invocation: model does not match any useResponseModels patterns
        await inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'unrelated-model',
          temperature: 0,
        });
        expect(spy).toHaveBeenCalledTimes(2); // Ensure no additional calls were made
      });
    });

    describe('DEBUG', () => {
      it('should tap the stream and return StreamingTextResponse when DEBUG_OPENROUTER_CHAT_COMPLETION is 1', async () => {
        // Arrange — the response must be async-iterable so the pass-through
        // debug tap (replacing the old Stream.tee() + debugStream path) can
        // observe each chunk without splitting the stream.
        const chunk = { id: 'c1', choices: [{ delta: { content: 'Hi' } }] };
        const mockStream = (async function* () {
          yield chunk;
        })();

        (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockStream);

        // Save original environment variable value
        const originalDebugValue = process.env.DEBUG_MOCKPROVIDER_CHAT_COMPLETION;

        // Mock environment variable
        process.env.DEBUG_MOCKPROVIDER_CHAT_COMPLETION = '1';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        try {
          // Execute test
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'mistralai/mistral-7b-instruct:free',
            temperature: 0,
          });

          const providerDebugCall = logSpy.mock.calls.find(
            ([label]) => label === '[provider-debug:request]',
          );
          expect(providerDebugCall).toBeDefined();
          expect(JSON.parse(providerDebugCall?.[1] as string)).toMatchObject({
            effectiveURL: {
              originHash: expect.stringMatching(/^[\da-f]{8}$/),
              pathDepth: 4,
              pathHash: expect.stringMatching(/^[\da-f]{8}$/),
              present: true,
              queryKeys: [],
              relative: false,
            },
            model: 'mistralai/mistral-7b-instruct:free',
            provider: 'groq',
            route: '/chat/completions',
            tools: { count: 0 },
            turnShape: { count: 1, sequence: ['user:text'] },
          });
        } finally {
          logSpy.mockRestore();
          process.env.DEBUG_MOCKPROVIDER_CHAT_COMPLETION = originalDebugValue;
        }
      });
    });
  });

  describe('createImage', () => {
    beforeEach(() => {
      // Mock convertImageUrlToFile since it's already tested in openaiHelpers.test.ts
      vi.spyOn(openaiHelpers, 'convertImageUrlToFile').mockResolvedValue(
        new File(['mock-file-content'], 'test-image.jpg', { type: 'image/jpeg' }),
      );
    });

    describe('basic image generation', () => {
      it('should generate image successfully without imageUrls', async () => {
        const mockResponse = {
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            },
          ],
        };

        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'dall-e-3',
          params: {
            prompt: 'A beautiful sunset',
            quality: 'standard',
            size: '1024x1024',
          },
        };

        const result = await (instance as any).createImage(payload);

        expect(instance['client'].images.generate).toHaveBeenCalledWith({
          model: 'dall-e-3',
          n: 1,
          prompt: 'A beautiful sunset',
          quality: 'standard',
          response_format: 'b64_json',
          size: '1024x1024',
        });

        expect(result).toEqual({
          imageUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        });
      });

      it('should handle size auto parameter correctly', async () => {
        const mockResponse = {
          data: [{ b64_json: 'mock-base64-data' }],
        };

        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'dall-e-3',
          params: {
            prompt: 'A beautiful sunset',
            size: 'auto',
          },
        };

        await (instance as any).createImage(payload);

        // size: 'auto' should be removed from the options
        expect(instance['client'].images.generate).toHaveBeenCalledWith({
          model: 'dall-e-3',
          n: 1,
          prompt: 'A beautiful sunset',
          response_format: 'b64_json',
        });
      });

      it('should not add response_format parameter for gpt-image-1 model', async () => {
        const mockResponse = {
          data: [{ b64_json: 'gpt-image-1-base64-data' }],
        };

        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'gpt-image-1',
          params: {
            prompt: 'A modern digital artwork',
            size: '1024x1024',
          },
        };

        const result = await (instance as any).createImage(payload);

        // gpt-image-1 model should not include response_format parameter
        expect(instance['client'].images.generate).toHaveBeenCalledWith({
          model: 'gpt-image-1',
          n: 1,
          prompt: 'A modern digital artwork',
          size: '1024x1024',
        });

        expect(result).toEqual({
          imageUrl: 'data:image/png;base64,gpt-image-1-base64-data',
        });
      });
    });

    describe('image editing', () => {
      it('should edit image with single imageUrl', async () => {
        const mockResponse = {
          data: [{ b64_json: 'edited-image-base64' }],
        };

        vi.spyOn(instance['client'].images, 'edit').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'dall-e-2',
          params: {
            imageUrls: ['https://example.com/image1.jpg'],
            mask: 'https://example.com/mask.jpg',
            prompt: 'Add a rainbow to this image',
          },
        };

        const result = await (instance as any).createImage(payload);

        expect(openaiHelpers.convertImageUrlToFile).toHaveBeenCalledWith(
          'https://example.com/image1.jpg',
        );
        expect(instance['client'].images.edit).toHaveBeenCalledWith({
          image: expect.any(File),
          input_fidelity: 'high',
          mask: 'https://example.com/mask.jpg',
          model: 'dall-e-2',
          n: 1,
          prompt: 'Add a rainbow to this image',
          response_format: 'b64_json',
        });

        expect(result).toEqual({
          imageUrl: 'data:image/png;base64,edited-image-base64',
        });
      });

      it('should edit image with multiple imageUrls', async () => {
        const mockResponse = {
          data: [{ b64_json: 'edited-multiple-images-base64' }],
        };

        const mockFile1 = new File(['content1'], 'image1.jpg', { type: 'image/jpeg' });
        const mockFile2 = new File(['content2'], 'image2.jpg', { type: 'image/jpeg' });

        vi.mocked(openaiHelpers.convertImageUrlToFile)
          .mockResolvedValueOnce(mockFile1)
          .mockResolvedValueOnce(mockFile2);

        vi.spyOn(instance['client'].images, 'edit').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'dall-e-2',
          params: {
            imageUrls: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
            prompt: 'Merge these images',
          },
        };

        const result = await (instance as any).createImage(payload);

        expect(openaiHelpers.convertImageUrlToFile).toHaveBeenCalledTimes(2);
        expect(openaiHelpers.convertImageUrlToFile).toHaveBeenCalledWith(
          'https://example.com/image1.jpg',
        );
        expect(openaiHelpers.convertImageUrlToFile).toHaveBeenCalledWith(
          'https://example.com/image2.jpg',
        );

        expect(instance['client'].images.edit).toHaveBeenCalledWith({
          image: [mockFile1, mockFile2],
          input_fidelity: 'high',
          model: 'dall-e-2',
          n: 1,
          prompt: 'Merge these images',
          response_format: 'b64_json',
        });

        expect(result).toEqual({
          imageUrl: 'data:image/png;base64,edited-multiple-images-base64',
        });
      });

      it('should handle convertImageUrlToFile error', async () => {
        vi.mocked(openaiHelpers.convertImageUrlToFile).mockRejectedValue(
          new Error('Failed to download image'),
        );

        const payload = {
          model: 'dall-e-2',
          params: {
            imageUrls: ['https://invalid-url.com/image.jpg'],
            prompt: 'Edit this image',
          },
        };

        await expect((instance as any).createImage(payload)).rejects.toThrow(
          'Failed to convert image URLs to File objects: Error: Failed to download image',
        );
      });
    });

    describe('error handling', () => {
      it('should throw error when API response is invalid - no data', async () => {
        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({} as any);

        const payload = {
          model: 'dall-e-3',
          params: { prompt: 'Test prompt' },
        };

        await expect((instance as any).createImage(payload)).rejects.toThrow(
          'Invalid image response: missing or empty data array',
        );
      });

      it('should throw error when API response is invalid - empty data array', async () => {
        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
          data: [],
        } as any);

        const payload = {
          model: 'dall-e-3',
          params: { prompt: 'Test prompt' },
        };

        await expect((instance as any).createImage(payload)).rejects.toThrow(
          'Invalid image response: missing or empty data array',
        );
      });

      it('should throw error when first data item is null', async () => {
        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
          data: [null],
        } as any);

        const payload = {
          model: 'dall-e-3',
          params: { prompt: 'Test prompt' },
        };

        await expect((instance as any).createImage(payload)).rejects.toThrow(
          'Invalid image response: first data item is null or undefined',
        );
      });

      it('should handle url format response successfully', async () => {
        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
          data: [{ url: 'https://example.com/generated-image.jpg' }],
        } as any);

        const payload = {
          model: 'dall-e-3',
          params: { prompt: 'Test prompt' },
        };

        const result = await (instance as any).createImage(payload);

        expect(result).toEqual({
          imageUrl: 'https://example.com/generated-image.jpg',
        });
      });

      it('should throw error when both b64_json and url are missing', async () => {
        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
          data: [{ some_other_field: 'value' }],
        } as any);

        const payload = {
          model: 'dall-e-3',
          params: { prompt: 'Test prompt' },
        };

        await expect((instance as any).createImage(payload)).rejects.toThrow(
          'Invalid image response: missing both b64_json and url fields',
        );
      });
    });

    describe('parameter mapping', () => {
      it('should map imageUrls parameter to image', async () => {
        const mockResponse = {
          data: [{ b64_json: 'test-base64' }],
        };

        vi.spyOn(instance['client'].images, 'edit').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'dall-e-2',
          params: {
            customParam: 'should remain unchanged',
            imageUrls: ['https://example.com/image.jpg'],
            prompt: 'Test prompt',
          },
        };

        await (instance as any).createImage(payload);

        expect(instance['client'].images.edit).toHaveBeenCalledWith({
          customParam: 'should remain unchanged',
          image: expect.any(File),
          input_fidelity: 'high',
          model: 'dall-e-2',
          n: 1,
          prompt: 'Test prompt',
          response_format: 'b64_json',
        });
      });

      it('should handle parameters without imageUrls', async () => {
        const mockResponse = {
          data: [{ b64_json: 'test-base64' }],
        };

        vi.spyOn(instance['client'].images, 'generate').mockResolvedValue(mockResponse as any);

        const payload = {
          model: 'dall-e-3',
          params: {
            prompt: 'Test prompt',
            quality: 'hd',
            style: 'vivid',
          },
        };

        await (instance as any).createImage(payload);

        expect(instance['client'].images.generate).toHaveBeenCalledWith({
          model: 'dall-e-3',
          n: 1,
          prompt: 'Test prompt',
          quality: 'hd',
          response_format: 'b64_json',
          style: 'vivid',
        });
      });
    });
  });

  describe('generateObject', () => {
    it('should return parsed JSON object on successful API call', async () => {
      const mockResponse = {
        output_text: '{"name": "John", "age": 30}',
      };

      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(mockResponse as any);

      const payload = {
        messages: [{ content: 'Generate a person object', role: 'user' as const }],
        model: 'gpt-4o',
        responseApi: true,
        schema: {
          description: 'Extract person information',
          name: 'person_extractor',
          schema: {
            properties: { age: { type: 'number' }, name: { type: 'string' } },
            type: 'object' as const,
          },
          strict: true,
        },
      };

      const result = await instance.generateObject(payload);

      expect(instance['client'].responses.create).toHaveBeenCalledWith(
        {
          input: payload.messages,
          model: payload.model,
          // @ts-ignore
          text: { format: { strict: true, type: 'json_schema', ...payload.schema } },
          user: undefined,
        },
        { headers: undefined, signal: undefined },
      );

      expect(result).toEqual({ age: 30, name: 'John' });
    });

    it('should handle options correctly', async () => {
      const mockResponse = {
        output_text: '{"status": "success"}',
      };

      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(mockResponse as any);

      const payload = {
        messages: [{ content: 'Generate status', role: 'user' as const }],
        model: 'gpt-4o',
        responseApi: true,
        schema: {
          name: 'status_extractor',
          schema: { properties: { status: { type: 'string' } }, type: 'object' as const },
        },
      };

      const options = {
        headers: { 'Custom-Header': 'test-value' },
        signal: new AbortController().signal,
        user: 'test-user',
      };

      const result = await instance.generateObject(payload, options);

      expect(instance['client'].responses.create).toHaveBeenCalledWith(
        {
          input: payload.messages,
          model: payload.model,
          // @ts-ignore
          text: { format: { strict: true, type: 'json_schema', ...payload.schema } },
          user: options.user,
        },
        { headers: options.headers, signal: options.signal },
      );

      expect(result).toEqual({ status: 'success' });
    });

    it('should return undefined when JSON parsing fails', async () => {
      const mockResponse = {
        output_text: 'invalid json string',
      };

      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(mockResponse as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'gpt-4o',
        responseApi: true,
        schema: {
          name: 'test_tool',
          schema: { properties: {}, type: 'object' as const },
        },
      };

      const result = await instance.generateObject(payload);

      expect(consoleSpy).toHaveBeenCalledWith('parse json error:', 'invalid json string');
      expect(result).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should handle empty response text', async () => {
      const mockResponse = {
        output_text: '',
      };

      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(mockResponse as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'gpt-4o',
        responseApi: true,
        schema: {
          name: 'test_tool',
          schema: { properties: {}, type: 'object' as const },
        },
      };

      const result = await instance.generateObject(payload);

      expect(consoleSpy).toHaveBeenCalledWith('parse json error:', '');
      expect(result).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should handle complex nested JSON objects', async () => {
      const mockResponse = {
        output_text:
          '{"user": {"name": "Alice", "profile": {"age": 25, "preferences": ["music", "sports"]}}, "metadata": {"created": "2024-01-01"}}',
      };

      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(mockResponse as any);

      const payload = {
        messages: [{ content: 'Generate complex user data', role: 'user' as const }],
        model: 'gpt-4o',
        responseApi: true,
        schema: {
          name: 'user_extractor',
          schema: {
            properties: {
              metadata: { type: 'object' },
              user: {
                properties: {
                  name: { type: 'string' },
                  profile: {
                    properties: {
                      age: { type: 'number' },
                      preferences: { items: { type: 'string' }, type: 'array' },
                    },
                    type: 'object',
                  },
                },
                type: 'object',
              },
            },
            type: 'object' as const,
          },
        },
      };

      const result = await instance.generateObject(payload);

      expect(result).toEqual({
        metadata: {
          created: '2024-01-01',
        },
        user: {
          name: 'Alice',
          profile: {
            age: 25,
            preferences: ['music', 'sports'],
          },
        },
      });
    });

    it('should propagate errors from responses API', async () => {
      const apiError = new Error('API Error: Invalid schema format');

      vi.spyOn(instance['client'].responses, 'create').mockRejectedValue(apiError);

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'gpt-4o',
        responseApi: true,
        schema: {
          name: 'test_tool',
          schema: { properties: {}, type: 'object' as const },
        },
      };

      await expect(instance.generateObject(payload)).rejects.toThrow(
        'API Error: Invalid schema format',
      );
    });

    describe('chat completions API path', () => {
      it('should return parsed JSON object using chat completions API', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content: '{"name": "Bob", "age": 25}',
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Generate a person object', role: 'user' as const }],
          model: 'gpt-4o',
          schema: {
            name: 'person_extractor',
            schema: {
              properties: { age: { type: 'number' }, name: { type: 'string' } },
              type: 'object' as const,
            },
          },
          // responseApi: false or undefined - uses chat completions API
        };

        const result = await instance.generateObject(payload);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          {
            messages: payload.messages,
            model: payload.model,
            response_format: { json_schema: payload.schema, type: 'json_schema' },
            user: undefined,
          },
          { headers: undefined, signal: undefined },
        );

        expect(result).toEqual({ age: 25, name: 'Bob' });
      });

      it('should handle options correctly with chat completions API', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content: '{"status": "completed"}',
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Generate status', role: 'user' as const }],
          model: 'gpt-4o',
          responseApi: false,
          schema: {
            name: 'status_extractor',
            schema: { properties: { status: { type: 'string' } }, type: 'object' as const },
          },
        };

        const options = {
          headers: { Authorization: 'Bearer token' },
          signal: new AbortController().signal,
          user: 'test-user-123',
        };

        const result = await instance.generateObject(payload, options);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          {
            messages: payload.messages,
            model: payload.model,
            response_format: { json_schema: payload.schema, type: 'json_schema' },
            user: options.user,
          },
          { headers: options.headers, signal: options.signal },
        );

        expect(result).toEqual({ status: 'completed' });
      });

      it('should return undefined when JSON parsing fails with chat completions API', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content: 'This is not valid JSON',
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const payload = {
          messages: [{ content: 'Generate data', role: 'user' as const }],
          model: 'gpt-4o',
          responseApi: false,
          schema: {
            name: 'test_tool',
            schema: { properties: {}, type: 'object' as const },
          },
        };

        const result = await instance.generateObject(payload);

        expect(consoleSpy).toHaveBeenCalledWith('parse json error:', 'This is not valid JSON');
        expect(result).toBeUndefined();

        consoleSpy.mockRestore();
      });

      it('should handle empty string content from chat completions API', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content: '',
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const payload = {
          messages: [{ content: 'Generate data', role: 'user' as const }],
          model: 'gpt-4o',
          responseApi: false,
          schema: {
            name: 'test_tool',
            schema: { properties: {}, type: 'object' as const },
          },
        };

        const result = await instance.generateObject(payload);

        expect(consoleSpy).toHaveBeenCalledWith('parse json error:', '');
        expect(result).toBeUndefined();

        consoleSpy.mockRestore();
      });

      it('should handle complex arrays with chat completions API', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content:
                  '{"items": [{"id": 1, "name": "Item 1"}, {"id": 2, "name": "Item 2"}], "total": 2}',
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Generate items list', role: 'user' as const }],
          model: 'gpt-4o',
          schema: {
            name: 'abc',
            schema: {
              properties: {
                items: {
                  items: {
                    properties: {
                      id: { type: 'number' },
                      name: { type: 'string' },
                    },
                    type: 'object',
                  },
                  type: 'array',
                },
                total: { type: 'number' },
              },
              type: 'object' as const,
            },
          },
        };

        const result = await instance.generateObject(payload);

        expect(result).toEqual({
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
          ],
          total: 2,
        });
      });

      it('should propagate errors from chat completions API', async () => {
        const apiError = new Error('API Error: Rate limit exceeded');

        vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

        const payload = {
          messages: [{ content: 'Generate data', role: 'user' as const }],
          model: 'gpt-4o',
          responseApi: false,
          schema: { name: 'abc', schema: { type: 'object' } as any },
        };

        await expect(instance.generateObject(payload)).rejects.toThrow(
          'API Error: Rate limit exceeded',
        );
      });
    });

    describe('tools parameter support', () => {
      it('should handle tools parameter with multiple tools', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"city":"Tokyo","unit":"celsius"}',
                      name: 'get_weather',
                    },
                    type: 'function' as const,
                  },
                  {
                    function: {
                      arguments: '{"timezone":"Asia/Tokyo"}',
                      name: 'get_time',
                    },
                    type: 'function' as const,
                  },
                ],
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'What is the weather and time in Tokyo?', role: 'user' as const }],
          model: 'gpt-4o',
          tools: [
            {
              function: {
                description: 'Get weather information',
                name: 'get_weather',
                parameters: {
                  properties: {
                    city: { type: 'string' },
                    unit: { type: 'string' },
                  },
                  required: ['city'],
                  type: 'object' as const,
                },
              },
              type: 'function' as const,
            },
            {
              function: {
                description: 'Get current time',
                name: 'get_time',
                parameters: {
                  properties: {
                    timezone: { type: 'string' },
                  },
                  required: ['timezone'],
                  type: 'object' as const,
                },
              },
              type: 'function' as const,
            },
          ],
        };

        const result = await instance.generateObject(payload);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          {
            messages: payload.messages,
            model: payload.model,
            tool_choice: 'required',
            tools: [
              {
                function: {
                  description: 'Get weather information',
                  name: 'get_weather',
                  parameters: {
                    properties: {
                      city: { type: 'string' },
                      unit: { type: 'string' },
                    },
                    required: ['city'],
                    type: 'object',
                  },
                },
                type: 'function',
              },
              {
                function: {
                  description: 'Get current time',
                  name: 'get_time',
                  parameters: {
                    properties: {
                      timezone: { type: 'string' },
                    },
                    required: ['timezone'],
                    type: 'object',
                  },
                },
                type: 'function',
              },
            ],
            user: undefined,
          },
          { headers: undefined, signal: undefined },
        );

        expect(result).toEqual([
          { arguments: { city: 'Tokyo', unit: 'celsius' }, name: 'get_weather' },
          { arguments: { timezone: 'Asia/Tokyo' }, name: 'get_time' },
        ]);
      });

      it('should handle tools parameter with systemRole', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"result":8}',
                      name: 'calculate',
                    },
                    type: 'function' as const,
                  },
                ],
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Add 5 and 3', role: 'user' as const }],
          model: 'gpt-4o',
          tools: [
            {
              function: {
                description: 'Perform calculation',
                name: 'calculate',
                parameters: {
                  properties: {
                    result: { type: 'number' },
                  },
                  required: ['result'],
                  type: 'object' as const,
                },
              },
              type: 'function' as const,
            },
          ],
        };

        const result = await instance.generateObject(payload);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [{ content: 'Add 5 and 3', role: 'user' }],
          }),
          expect.any(Object),
        );

        expect(result).toEqual([{ arguments: { result: 8 }, name: 'calculate' }]);
      });

      it('should throw error when neither tools nor schema is provided', async () => {
        const payload = {
          messages: [{ content: 'Generate data', role: 'user' as const }],
          model: 'gpt-4o',
        };

        await expect(instance.generateObject(payload as any)).rejects.toThrow(
          'tools or schema is required',
        );
      });
    });

    describe('handleSchema option', () => {
      let instanceWithSchemaHandler: any;
      const mockSchemaHandler = vi.fn((schema: any) => {
        const filtered: any = {};
        for (const [key, value] of Object.entries(schema)) {
          if (key !== 'maxLength' && key !== 'pattern') {
            filtered[key] = value;
          }
        }
        return filtered;
      });

      beforeEach(() => {
        mockSchemaHandler.mockClear();
        const RuntimeClass = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com',
          generateObject: {
            handleSchema: mockSchemaHandler,
          },
          provider: 'test-provider',
        });

        instanceWithSchemaHandler = new RuntimeClass({ apiKey: 'test-key' });
      });

      it('should apply schema transformation with Responses API', async () => {
        const mockResponse = {
          output_text: '{"name":"Alice","age":30}',
        };

        vi.spyOn(instanceWithSchemaHandler['client'].responses, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Extract person', role: 'user' as const }],
          model: 'gpt-4o',
          responseApi: true,
          schema: {
            name: 'person',
            schema: {
              maxLength: 100,
              pattern: '^[a-z]+$',
              properties: {
                age: { type: 'number' },
                name: { type: 'string' },
              },
              type: 'object' as const,
            },
          },
        };

        await instanceWithSchemaHandler.generateObject(payload);

        expect(mockSchemaHandler).toHaveBeenCalledWith(payload.schema.schema);
        expect(instanceWithSchemaHandler['client'].responses.create).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.objectContaining({
              format: expect.objectContaining({
                schema: {
                  properties: {
                    age: { type: 'number' },
                    name: { type: 'string' },
                  },
                  type: 'object',
                },
              }),
            }),
          }),
          expect.any(Object),
        );
      });

      it('should apply schema transformation with Chat Completions API', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content: '{"name":"Bob","age":25}',
              },
            },
          ],
        };

        vi.spyOn(instanceWithSchemaHandler['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Extract person', role: 'user' as const }],
          model: 'test-model',
          schema: {
            name: 'person',
            schema: {
              maxLength: 100,
              pattern: '^[a-z]+$',
              properties: {
                age: { type: 'number' },
                name: { type: 'string' },
              },
              type: 'object' as const,
            },
          },
        };

        await instanceWithSchemaHandler.generateObject(payload);

        expect(mockSchemaHandler).toHaveBeenCalledWith(payload.schema.schema);
        expect(instanceWithSchemaHandler['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            response_format: expect.objectContaining({
              json_schema: expect.objectContaining({
                schema: {
                  properties: {
                    age: { type: 'number' },
                    name: { type: 'string' },
                  },
                  type: 'object',
                },
              }),
            }),
          }),
          expect.any(Object),
        );
      });

      it('should apply schema transformation with tool calling fallback', async () => {
        const RuntimeClass = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com',
          generateObject: {
            handleSchema: mockSchemaHandler,
            useToolsCalling: true,
          },
          provider: 'test-provider',
        });

        const instance = new RuntimeClass({ apiKey: 'test-key' });

        const mockResponse = {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"name":"Charlie","age":35}',
                      name: 'person',
                    },
                    type: 'function' as const,
                  },
                ],
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Extract person', role: 'user' as const }],
          model: 'test-model',
          schema: {
            name: 'person',
            schema: {
              maxLength: 100,
              pattern: '^[a-z]+$',
              properties: {
                age: { type: 'number' },
                name: { type: 'string' },
              },
              type: 'object' as const,
            },
          },
        };

        await instance.generateObject(payload);

        expect(mockSchemaHandler).toHaveBeenCalledWith(payload.schema.schema);
        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              expect.objectContaining({
                function: expect.objectContaining({
                  parameters: {
                    properties: {
                      age: { type: 'number' },
                      name: { type: 'string' },
                    },
                    type: 'object',
                  },
                }),
              }),
            ],
          }),
          expect.any(Object),
        );
      });

      it('should not apply schema transformation when handleSchema is not configured', async () => {
        const RuntimeClass = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com',
          provider: 'test-provider',
        });

        const instance = new RuntimeClass({ apiKey: 'test-key' });

        const mockResponse = {
          choices: [
            {
              message: {
                content: '{"name":"Test"}',
              },
            },
          ],
        };

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Extract data', role: 'user' as const }],
          model: 'test-model',
          schema: {
            name: 'test',
            schema: {
              maxLength: 100,
              properties: {
                name: { type: 'string' },
              },
              type: 'object' as const,
            },
          },
        };

        await instance.generateObject(payload);

        expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            response_format: expect.objectContaining({
              json_schema: expect.objectContaining({
                schema: {
                  maxLength: 100,
                  properties: {
                    name: { type: 'string' },
                  },
                  type: 'object',
                },
              }),
            }),
          }),
          expect.any(Object),
        );
      });

      it('should preserve original schema properties while filtering', async () => {
        const mockResponse = {
          output_text: '{"result":"success"}',
        };

        vi.spyOn(instanceWithSchemaHandler['client'].responses, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Test', role: 'user' as const }],
          model: 'gpt-4o',
          responseApi: true,
          schema: {
            description: 'Test schema',
            name: 'test',
            schema: {
              description: 'Inner schema description',
              maxLength: 100,
              pattern: '^test$',
              properties: {
                result: { type: 'string' },
              },
              required: ['result'],
              type: 'object' as const,
            },
            strict: true,
          },
        };

        await instanceWithSchemaHandler.generateObject(payload);

        expect(mockSchemaHandler).toHaveBeenCalledWith(payload.schema.schema);
        expect(instanceWithSchemaHandler['client'].responses.create).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.objectContaining({
              format: expect.objectContaining({
                description: 'Test schema',
                name: 'test',
                schema: {
                  description: 'Inner schema description',
                  properties: {
                    result: { type: 'string' },
                  },
                  required: ['result'],
                  type: 'object',
                },
                strict: true,
              }),
            }),
          }),
          expect.any(Object),
        );
      });
    });

    describe('tool calling fallback', () => {
      let instanceWithToolCalling: any;

      beforeEach(() => {
        const RuntimeClass = createOpenAICompatibleRuntime({
          baseURL: 'https://api.test.com',
          generateObject: {
            useToolsCalling: true,
          },
          provider: 'test-provider',
        });

        instanceWithToolCalling = new RuntimeClass({ apiKey: 'test-key' });
      });

      it('should use tool calling when configured', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"name":"Alice","age":28}',
                      name: 'person_extractor',
                    },
                    type: 'function' as const,
                  },
                ],
              },
            },
          ],
        };

        vi.spyOn(instanceWithToolCalling['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Extract person info', role: 'user' as const }],
          model: 'test-model',
          schema: {
            description: 'Extract person information',
            name: 'person_extractor',
            schema: {
              properties: { age: { type: 'number' }, name: { type: 'string' } },
              type: 'object' as const,
            },
          },
        };

        const result = await instanceWithToolCalling.generateObject(payload);

        expect(instanceWithToolCalling['client'].chat.completions.create).toHaveBeenCalledWith(
          {
            messages: payload.messages,
            model: payload.model,
            tool_choice: { function: { name: 'person_extractor' }, type: 'function' },
            tools: [
              {
                function: {
                  description: 'Extract person information',
                  name: 'person_extractor',
                  parameters: payload.schema.schema,
                },
                type: 'function',
              },
            ],
            user: undefined,
          },
          { headers: undefined, signal: undefined },
        );

        expect(result).toEqual([
          { arguments: { age: 28, name: 'Alice' }, name: 'person_extractor' },
        ]);
      });

      it('should return undefined when no tool call found', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                content: 'Some text response',
              },
            },
          ],
        };

        vi.spyOn(instanceWithToolCalling['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const payload = {
          messages: [{ content: 'Generate data', role: 'user' as const }],
          model: 'test-model',
          schema: {
            name: 'test_tool',
            schema: { properties: {}, type: 'object' as const },
          },
        };

        const result = await instanceWithToolCalling.generateObject(payload);

        expect(consoleSpy).toHaveBeenCalledWith('parse tool call arguments error:', undefined);
        expect(result).toBeUndefined();

        consoleSpy.mockRestore();
      });

      it('should return undefined when tool call arguments parsing fails', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: 'invalid json',
                      name: 'test_tool',
                    },
                    type: 'function' as const,
                  },
                ],
              },
            },
          ],
        };

        vi.spyOn(instanceWithToolCalling['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const payload = {
          messages: [{ content: 'Generate data', role: 'user' as const }],
          model: 'test-model',
          schema: {
            name: 'test_tool',
            schema: { properties: {}, type: 'object' as const },
          },
        };

        const result = await instanceWithToolCalling.generateObject(payload);

        expect(consoleSpy).toHaveBeenCalledWith(
          'parse tool call arguments error:',
          mockResponse.choices[0].message.tool_calls,
        );
        expect(result).toBeUndefined();

        consoleSpy.mockRestore();
      });

      it('should handle options correctly with tool calling', async () => {
        const mockResponse = {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"data":"test"}',
                      name: 'data_extractor',
                    },
                    type: 'function' as const,
                  },
                ],
              },
            },
          ],
        };

        vi.spyOn(instanceWithToolCalling['client'].chat.completions, 'create').mockResolvedValue(
          mockResponse as any,
        );

        const payload = {
          messages: [{ content: 'Extract data', role: 'user' as const }],
          model: 'test-model',
          schema: {
            name: 'data_extractor',
            schema: { properties: { data: { type: 'string' } }, type: 'object' as const },
          },
        };

        const options = {
          headers: { 'X-Custom': 'header' },
          signal: new AbortController().signal,
          user: 'test-user',
        };

        const result = await instanceWithToolCalling.generateObject(payload, options);

        expect(instanceWithToolCalling['client'].chat.completions.create).toHaveBeenCalledWith(
          expect.any(Object),
          { headers: options.headers, signal: options.signal },
        );

        expect(result).toEqual([{ arguments: { data: 'test' }, name: 'data_extractor' }]);
      });
    });
  });

  describe('models', () => {
    it('should get models with third party model list', async () => {
      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({
        data: [
          { created: 1_698_218_177, id: 'gpt-4o', object: 'model' },
          { id: 'claude-3-haiku-20240307', object: 'model' },
          { created: 1_698_318_177 * 1000, id: 'gpt-4o-mini', object: 'model' },
          { created: 1_736_499_509_125, id: 'gemini', object: 'model' },
        ],
      } as any);

      const list = await instance.models();

      expect(list).toEqual([
        {
          abilities: {
            functionCall: true,
            vision: true,
          },
          config: {
            deploymentName: 'gpt-4o',
          },
          contextWindowTokens: 128_000,
          description:
            'ChatGPT-4o 是一款动态模型，实时更新以保持当前最新版本。它结合了强大的语言理解与生成能力，适合于大规模应用场景，包括客户服务、教育和技术支持。',
          displayName: 'GPT-4o',
          enabled: true,
          id: 'gpt-4o',
          maxOutput: 4096,
          pricing: {
            units: [
              {
                name: 'textInput_cacheRead',
                rate: 1.25,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textInput',
                rate: 2.5,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textOutput',
                rate: 10,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
            ],
          },
          providerId: 'azure',
          releasedAt: '2024-05-13',
          source: 'builtin',
          type: 'chat',
        },
        {
          abilities: {
            functionCall: true,
            vision: true,
          },
          contextWindowTokens: 200_000,
          description:
            'Claude 3 Haiku 是 Anthropic 的最快且最紧凑的模型，旨在实现近乎即时的响应。它具有快速且准确的定向性能。',
          displayName: 'Claude 3 Haiku',
          enabled: false,
          id: 'claude-3-haiku-20240307',
          maxOutput: 4096,
          pricing: {
            units: [
              {
                name: 'textInput_cacheRead',
                rate: 0.03,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textInput',
                rate: 0.25,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textOutput',
                rate: 1.25,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                lookup: {
                  prices: {
                    '1h': 0.5,
                    '5m': 0.3,
                  },
                  pricingParams: ['ttl'],
                },
                name: 'textInput_cacheWrite',
                strategy: 'lookup',
                unit: 'millionTokens',
              },
            ],
          },
          providerId: 'anthropic',
          releasedAt: '2024-03-07',
          settings: {
            extendParams: ['disableContextCaching'],
          },
          source: 'builtin',
          type: 'chat',
        },
        {
          abilities: {
            functionCall: true,
            vision: true,
          },
          config: {
            deploymentName: 'gpt-4o-mini',
          },
          contextWindowTokens: 128_000,
          description: 'GPT-4o Mini，小型高效模型，具备与GPT-4o相似的卓越性能。',
          displayName: 'GPT 4o Mini',
          enabled: false,
          id: 'gpt-4o-mini',
          maxOutput: 4096,
          pricing: {
            units: [
              {
                name: 'textInput_cacheRead',
                rate: 0.075,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textInput',
                rate: 0.15,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
              {
                name: 'textOutput',
                rate: 0.6,
                strategy: 'fixed',
                unit: 'millionTokens',
              },
            ],
          },
          providerId: 'azure',
          releasedAt: '2023-10-26',
          source: 'builtin',
          type: 'chat',
        },
        {
          id: 'gemini',
          releasedAt: '2025-01-10',
          type: 'chat',
        },
      ]);
    });
  });
});
