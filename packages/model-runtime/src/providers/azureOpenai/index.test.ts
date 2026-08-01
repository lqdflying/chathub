// @vitest-environment node
import { AzureOpenAI } from 'openai';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as openaiCompatibleFactoryModule from '../../core/openaiCompatibleFactory';
import type {
  ModelCacheDiagnosticContext,
  ModelCacheDiagnosticEvent,
} from '../../types/cacheDiagnostics';
import { LobeAzureOpenAI } from './index';

const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeAzureOpenAI', () => {
  let instance: LobeAzureOpenAI;

  beforeEach(() => {
    instance = new LobeAzureOpenAI({
      baseURL: 'https://test.openai.azure.com/',
      apiKey: 'test_key',
      apiVersion: '2023-03-15-preview',
    });

    // 使用 vi.spyOn 来模拟 streamChatCompletions 方法
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw InvalidAzureAPIKey error when apikey or endpoint is missing', () => {
      try {
        new LobeAzureOpenAI();
      } catch (e) {
        expect(e).toEqual({ errorType: invalidErrorType });
      }
    });

    it('should create an instance of OpenAIClient with correct parameters', () => {
      const baseURL = 'https://test.openai.azure.com/';
      const apiKey = 'test_key';
      const apiVersion = '2023-03-15-preview';

      const instance = new LobeAzureOpenAI({ baseURL, apiKey, apiVersion });

      expect(instance.client).toBeInstanceOf(AzureOpenAI);
      expect(instance.baseURL).toBe(baseURL);
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
        debugToolCache: {
          inputItemCount: 1,
          toolCallCount: 1,
          toolCallSetHash: '0123456789abcdef',
          toolResults: [],
        },
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ debugToolCache: expect.anything() }),
      );
    });

    it('should not forward internal compatible cache controls to Azure OpenAI', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o',
        openAICompatCache: {
          chat: {
            promptCacheKey: true,
            sessionHeader: true,
          },
        },
        openAICompatResponsesParams: {
          responseStateMode: 'prompt-key-store',
        },
        responseStateMode: 'prompt-key-store',
      } as any);

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).not.toHaveProperty('openAICompatCache');
      expect(requestPayload).not.toHaveProperty('openAICompatResponsesParams');
      expect(requestPayload).not.toHaveProperty('responseStateMode');
    });

    it('should send only the trusted prompt cache key for a validated deployment alias', async () => {
      const currentApiInstance = new LobeAzureOpenAI({
        apiKey: 'test_key',
        apiVersion: '2024-08-01-preview',
        baseURL: 'https://test.openai.azure.com/',
      });
      vi.spyOn(currentApiInstance['client'].chat.completions, 'create').mockResolvedValue(
        new ReadableStream() as any,
      );

      await currentApiInstance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'custom-production-deployment',
          prompt_cache_key: 'CLIENT_CONTROLLED_KEY',
        },
        {
          trustedCatalogModel: 'gpt-5.6-sol',
          trustedPromptCacheKey: 'ch_trustedpromptcachekey0123456789',
        },
      );

      const requestPayload = (currentApiInstance['client'].chat.completions.create as Mock).mock
        .calls[0][0];
      expect(requestPayload).toMatchObject({
        model: 'custom-production-deployment',
        prompt_cache_key: 'ch_trustedpromptcachekey0123456789',
        stream_options: { include_usage: true },
      });
      expect(JSON.stringify(requestPayload)).not.toContain('CLIENT_CONTROLLED_KEY');
    });

    it('should omit streaming usage for Azure API versions before 2024-08-01-preview', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4o',
      });

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).not.toHaveProperty('stream_options');
    });

    it('should not let a catalog model claim enable cache keys for a custom deployment', async () => {
      await instance.chat(
        {
          catalogModel: 'gpt-5.6-sol',
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'custom-production-deployment',
          provider: 'client-controlled-provider',
        },
        {
          trustedPromptCacheKey: 'ch_trustedpromptcachekey0123456789',
        },
      );

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).toMatchObject({
        model: 'custom-production-deployment',
      });
      expect(requestPayload).not.toHaveProperty('catalogModel');
      expect(requestPayload).not.toHaveProperty('prompt_cache_key');
      expect(requestPayload).not.toHaveProperty('provider');
    });

    it('should omit prompt cache keys for ineligible models', async () => {
      await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-5.5',
          prompt_cache_key: 'CLIENT_CONTROLLED_KEY',
        },
        {
          trustedCatalogModel: 'gpt-5.5',
          trustedPromptCacheKey: 'ch_trustedpromptcachekey0123456789',
        },
      );

      const requestPayload = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];
      expect(requestPayload).not.toHaveProperty('prompt_cache_key');
    });

    it('should repair parent-owned repeated tool results before the Azure request', async () => {
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
        model: 'gpt-4o',
      });

      const requestMessages = (instance['client'].chat.completions.create as Mock).mock.calls[0][0]
        .messages as any[];
      expect(requestMessages.map((message) => message.content)).toEqual([
        null,
        'first result',
        null,
        'second result',
      ]);
      expect(requestMessages.every((message) => !('id' in message))).toBe(true);
      expect(requestMessages.every((message) => !('parentId' in message))).toBe(true);
    });

    it('should finalize non-streaming cache diagnostics before body consumption', async () => {
      const events: ModelCacheDiagnosticEvent[] = [];
      const cacheDiagnostics: ModelCacheDiagnosticContext = {
        emit: (event) => events.push(event),
        fingerprint: (scope) => `${scope}-fingerprint`,
        provider: 'azure',
        runtimeFamily: 'azure-openai',
      };
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
        choices: [],
        created: 123,
        id: 'private-response-id',
        model: 'gpt-4o',
        object: 'chat.completion',
        usage: {
          completion_tokens: 5,
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 80 },
          total_tokens: 105,
        },
      } as any);

      const response = await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4o',
          stream: false,
        },
        { cacheDiagnostics },
      );

      expect(events.map((event) => event.type)).toEqual(['request', 'usage']);
      await response.text();
      expect(events.map((event) => event.type)).toEqual(['request', 'usage']);
    });

    describe('streaming response', () => {
      it('should handle multiple data chunks correctly', async () => {
        const data = [
          {
            choices: [],
            created: 0,
            id: '',
            model: '',
            object: '',
            prompt_filter_results: [
              {
                prompt_index: 0,
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
              },
            ],
          },
          {
            choices: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                delta: { content: '你' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1715516381,
            id: 'chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            model: 'gpt-35-turbo-16k',
            object: 'chat.completion.chunk',
            system_fingerprint: null,
          },
          {
            choices: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                delta: { content: '好' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1715516381,
            id: 'chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            model: 'gpt-35-turbo-16k',
            object: 'chat.completion.chunk',
            system_fingerprint: null,
          },
          {
            choices: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                delta: { content: '！' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1715516381,
            id: 'chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            model: 'gpt-35-turbo-16k',
            object: 'chat.completion.chunk',
            system_fingerprint: null,
          },
        ];

        const mockStream = new ReadableStream({
          start(controller) {
            data.forEach((chunk) => controller.enqueue(chunk));
            controller.close();
          },
        });
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockStream as any,
        );

        const result = await instance.chat({
          stream: true,
          max_tokens: 2048,
          temperature: 0.6,
          top_p: 1,
          model: 'gpt-35-turbo-16k',
          presence_penalty: 0,
          frequency_penalty: 0,
          messages: [{ role: 'user', content: '你好' }],
        });

        const decoder = new TextDecoder();
        const reader = result.body!.getReader();
        const stream: string[] = [];

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          stream.push(decoder.decode(value));
        }

        expect(stream).toEqual(
          [
            'id: ',
            'event: data',
            'data: {"choices":[],"created":0,"id":"","model":"","object":"","prompt_filter_results":[{"prompt_index":0,"content_filter_results":{"hate":{"filtered":false,"severity":"safe"},"self_harm":{"filtered":false,"severity":"safe"},"sexual":{"filtered":false,"severity":"safe"},"violence":{"filtered":false,"severity":"safe"}}}]}\n',
            'id: chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            'event: text',
            'data: "你"\n',
            'id: chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            'event: text',
            'data: "好"\n',
            'id: chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            'event: text',
            'data: "！"\n',
          ].map((item) => `${item}\n`),
        );
      });

      it('should handle non-streaming response', async () => {
        vi.spyOn(openaiCompatibleFactoryModule, 'transformResponseToStream').mockImplementation(
          () => {
            return new ReadableStream();
          },
        );
        // Act
        await instance.chat({
          stream: false,
          temperature: 0.6,
          model: 'gpt-35-turbo-16k',
          messages: [{ role: 'user', content: '你好' }],
        });

        // Assert
        expect(openaiCompatibleFactoryModule.transformResponseToStream).toHaveBeenCalled();
      });
    });

    it('should handle o1 series models without streaming', async () => {
      vi.spyOn(openaiCompatibleFactoryModule, 'transformResponseToStream').mockImplementation(
        () => {
          return new ReadableStream();
        },
      );

      // Act
      await instance.chat({
        temperature: 0.6,
        model: 'o1-preview',
        messages: [{ role: 'user', content: '你好' }],
      });

      // Assert
      expect(openaiCompatibleFactoryModule.transformResponseToStream).toHaveBeenCalled();
    });

    describe('Error', () => {
      it('should return AzureBizError with DeploymentNotFound error', async () => {
        // Arrange
        const error = {
          code: 'DeploymentNotFound',
          message: 'Deployment not found',
        };

        (instance['client'].chat.completions.create as Mock).mockRejectedValue(error);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: 'https://***.openai.azure.com/',
            error: {
              code: 'DeploymentNotFound',
              message: 'Deployment not found',
              deployId: 'text-davinci-003',
            },
            errorType: bizErrorType,
            provider: 'azure',
          });
        }
      });

      it('should return AgentRuntimeError for non-Azure errors', async () => {
        // Arrange
        const genericError = new Error('Generic Error');

        (instance['client'].chat.completions.create as Mock).mockRejectedValue(genericError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: 'https://***.openai.azure.com/',
            errorType: 'AgentRuntimeError',
            provider: 'azure',
            error: {
              name: genericError.name,
              cause: genericError.cause,
              message: genericError.message,
            },
          });
        }
      });
    });

    describe('DEBUG', () => {
      it('should observe the production stream when DEBUG_CHAT_COMPLETION is 1', async () => {
        const completionChunk = {
          choices: [{ delta: { content: 'Debug stream content' }, finish_reason: null, index: 0 }],
          id: 'chatcmpl-debug',
          model: 'text-davinci-003',
          object: 'chat.completion.chunk',
        };
        const mockStream = (async function* () {
          yield completionChunk;
          yield {
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
            id: 'chatcmpl-debug',
            model: 'text-davinci-003',
            object: 'chat.completion.chunk',
          };
        })();

        (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockStream);

        process.env.DEBUG_AZURE_CHAT_COMPLETION = '1';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        try {
          const response = await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
          await response.text();

          // delta chunks are merged into one consolidated record at stream end
          const record = logSpy.mock.calls
            .map(([line]) => line)
            .find((line) => typeof line === 'string' && line.includes('chatcmpl-debug'));
          expect(record).toBeDefined();
          expect(JSON.parse(record as string)).toMatchObject({
            finishReason: 'stop',
            id: 'chatcmpl-debug',
            model: 'text-davinci-003',
            text: 'Debug stream content',
          });
        } finally {
          logSpy.mockRestore();
          delete process.env.DEBUG_AZURE_CHAT_COMPLETION;
        }
      });
    });
  });

  describe('createImage', () => {
    beforeEach(() => {
      // ensure images namespace exists and is spy-able
      expect(instance['client'].images).toBeTruthy();
    });

    it('should generate image and return url from object response', async () => {
      const url = 'https://example.com/image.png';
      const generateSpy = vi
        .spyOn(instance['client'].images, 'generate')
        .mockResolvedValue({ data: [{ url }] } as any);

      const res = await instance.createImage({
        model: 'gpt-image-1',
        params: { prompt: 'a cat' },
      });

      expect(generateSpy).toHaveBeenCalledTimes(1);
      const args = vi.mocked(generateSpy).mock.calls[0][0] as any;
      expect(args).not.toHaveProperty('image');
      expect(res).toEqual({ imageUrl: url });
    });

    it('should parse string JSON response from images.generate', async () => {
      const url = 'https://example.com/str.png';
      const payload = JSON.stringify({ data: [{ url }] });
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue(payload as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'dog' } });
      expect(res).toEqual({ imageUrl: url });
    });

    it('should parse bodyAsText JSON response', async () => {
      const url = 'https://example.com/bodyAsText.png';
      const bodyAsText = JSON.stringify({ data: [{ url }] });
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({ bodyAsText } as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'bird' } });
      expect(res).toEqual({ imageUrl: url });
    });

    it('should parse body JSON response', async () => {
      const url = 'https://example.com/body.png';
      const body = JSON.stringify({ data: [{ url }] });
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({ body } as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'fish' } });
      expect(res).toEqual({ imageUrl: url });
    });

    it('should prefer b64_json and return data URL', async () => {
      const b64 = 'AAA';
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
        data: [{ b64_json: b64 }],
      } as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'sun' } });
      expect(res.imageUrl).toBe(`data:image/png;base64,${b64}`);
    });

    it('should throw wrapped error for empty data array', async () => {
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({ data: [] } as any);

      await expect(
        instance.createImage({ model: 'gpt-image-1', params: { prompt: 'moon' } }),
      ).rejects.toMatchObject({
        endpoint: 'https://***.openai.azure.com/',
        errorType: 'AgentRuntimeError',
        provider: 'azure',
        error: {
          name: 'Error',
          cause: undefined,
          message: expect.stringContaining('Invalid image response: missing or empty data array'),
        },
      });
    });

    it('should throw wrapped error when missing both b64_json and url', async () => {
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
        data: [{}],
      } as any);

      await expect(
        instance.createImage({ model: 'gpt-image-1', params: { prompt: 'stars' } }),
      ).rejects.toEqual({
        endpoint: 'https://***.openai.azure.com/',
        errorType: 'AgentRuntimeError',
        provider: 'azure',
        error: {
          name: 'Error',
          cause: undefined,
          message: 'Invalid image response: missing both b64_json and url fields',
        },
      });
    });

    it('should call images.edit when imageUrl provided and strip size:auto', async () => {
      const url = 'https://example.com/edited.png';
      const editSpy = vi
        .spyOn(instance['client'].images, 'edit')
        .mockResolvedValue({ data: [{ url }] } as any);

      const helpers = await import('../../core/contextBuilders/openai');
      vi.spyOn(helpers, 'convertImageUrlToFile').mockResolvedValue({} as any);

      const res = await instance.createImage({
        model: 'gpt-image-1',
        params: { prompt: 'edit', imageUrl: 'https://example.com/in.png', size: 'auto' as any },
      });

      expect(editSpy).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(editSpy).mock.calls[0][0] as any;
      expect(arg).not.toHaveProperty('size');
      expect(res).toEqual({ imageUrl: url });
    });

    it('should convert multiple imageUrls and pass images array to edit', async () => {
      const url = 'https://example.com/edited2.png';
      const editSpy = vi
        .spyOn(instance['client'].images, 'edit')
        .mockResolvedValue({ data: [{ url }] } as any);

      const helpers = await import('../../core/contextBuilders/openai');
      const spy = vi.spyOn(helpers, 'convertImageUrlToFile').mockResolvedValue({} as any);

      await instance.createImage({
        model: 'gpt-image-1',
        params: { prompt: 'edit', imageUrls: ['u1', 'u2'] },
      });

      expect(spy).toHaveBeenCalledTimes(2);
      const arg = vi.mocked(editSpy).mock.calls[0][0] as any;
      expect(arg).toHaveProperty('image');
    });

    it('should not include image in generate options', async () => {
      const generateSpy = vi
        .spyOn(instance['client'].images, 'generate')
        .mockResolvedValue({ data: [{ url: 'https://x/y.png' }] } as any);

      await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'no image' } });

      const arg = vi.mocked(generateSpy).mock.calls[0][0] as any;
      expect(arg).not.toHaveProperty('image');
    });
  });

  describe('private method', () => {
    describe('tocamelCase', () => {
      it('should convert string to camel case', () => {
        const key = 'image_url';

        const camelCaseKey = instance['tocamelCase'](key);

        expect(camelCaseKey).toEqual('imageUrl');
      });
    });

    describe('camelCaseKeys', () => {
      it('should convert object keys to camel case', () => {
        const obj = {
          frequency_penalty: 0,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: '<image URL>',
                  },
                },
              ],
            },
          ],
        };

        const newObj = instance['camelCaseKeys'](obj);

        expect(newObj).toEqual({
          frequencyPenalty: 0,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  imageUrl: {
                    url: '<image URL>',
                  },
                },
              ],
            },
          ],
        });
      });
    });
  });
});
