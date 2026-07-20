// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ModelCacheDiagnosticContext,
  ModelCacheDiagnosticEvent,
} from '../../types/cacheDiagnostics';
import { AgentRuntimeErrorType } from '../../types/error';
import { LobeAzureAI } from './index';

describe('LobeAzureAI', () => {
  describe('constructor', () => {
    it('should throw error when apiKey is missing', () => {
      expect(() => new LobeAzureAI({ baseURL: 'https://test.azure.com' })).toThrow();
    });

    it('should throw error when baseURL is missing', () => {
      expect(() => new LobeAzureAI({ apiKey: 'test-key' })).toThrow();
    });

    it('should throw InvalidProviderAPIKey error when both apiKey and baseURL are missing', () => {
      try {
        new LobeAzureAI();
      } catch (error: any) {
        expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      }
    });

    it('should initialize successfully with valid params', () => {
      const instance = new LobeAzureAI({
        apiKey: 'test-key',
        baseURL: 'https://test.cognitiveservices.azure.com/openai',
      });

      expect(instance).toBeDefined();
      expect(instance.baseURL).toBe('https://test.cognitiveservices.azure.com/openai');
    });
  });

  describe('chat', () => {
    let instance: LobeAzureAI;

    beforeEach(() => {
      instance = new LobeAzureAI({
        apiKey: 'test-key',
        baseURL: 'https://test.cognitiveservices.azure.com/openai',
      });
    });

    it('should handle non-streaming responses', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello, how can I help you?',
              role: 'assistant',
            },
          },
        ],
        model: 'gpt-4',
      };

      const mockPost = vi.fn().mockResolvedValue({
        body: mockResponse,
      });

      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
      } as any);

      const result = await instance.chat({
        debugToolCache: {
          inputItemCount: 1,
          toolCallCount: 1,
          toolCallSetHash: '0123456789abcdef',
          toolResults: [],
        },
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-4',
        stream: false,
      });

      expect(result).toBeDefined();
      expect(instance.client.path).toHaveBeenCalledWith('/chat/completions');
      expect(mockPost).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith({
        body: expect.not.objectContaining({ debugToolCache: expect.anything() }),
      });
    });

    it('should not forward internal compatible cache controls to Azure AI Inference', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        body: {
          choices: [],
          created: 123,
          id: 'response-id',
          model: 'gpt-4o',
          object: 'chat.completion',
        },
      });
      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
      } as any);

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
        stream: false,
      } as any);

      const requestBody = mockPost.mock.calls[0][0].body;
      expect(requestBody).not.toHaveProperty('openAICompatCache');
      expect(requestBody).not.toHaveProperty('openAICompatResponsesParams');
      expect(requestBody).not.toHaveProperty('responseStateMode');
    });

    it('should report cache telemetry as unobservable without leaking internal metadata', async () => {
      const events: ModelCacheDiagnosticEvent[] = [];
      const cacheDiagnostics: ModelCacheDiagnosticContext = {
        emit: (event) => events.push(event),
        fingerprint: (scope) => `${scope}-fingerprint`,
        provider: ModelProvider.AzureAI,
        runtimeFamily: 'azure-ai',
        toolCache: {
          inputItemCount: 1,
          toolCallCount: 1,
          toolCallSetHash: '0123456789abcdef',
          toolResults: [],
        },
      };
      const mockPost = vi.fn().mockResolvedValue({
        body: {
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: 'Hello, how can I help you?',
                role: 'assistant',
              },
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
        },
      });

      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
      } as any);

      const response = await instance.chat(
        {
          debugToolCache: cacheDiagnostics.toolCache,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'private-model-id',
          stream: false,
        },
        { cacheDiagnostics },
      );
      await response.text();

      expect(mockPost.mock.calls[0][0].body).not.toHaveProperty('debugToolCache');
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

    it('should repair parent-owned repeated tool results before the Azure AI request', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        body: {
          choices: [],
          created: 123,
          id: 'response-id',
          model: 'private-model-id',
          object: 'chat.completion',
        },
      });
      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
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
        stream: false,
      });

      const requestMessages = mockPost.mock.calls[0][0].body.messages as any[];
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
        provider: ModelProvider.AzureAI,
        runtimeFamily: 'azure-ai',
      };
      const mockPost = vi.fn().mockResolvedValue({
        body: {
          choices: [],
          created: 123,
          id: 'response-id',
          model: 'private-model-id',
          object: 'chat.completion',
          usage: {
            completion_tokens: 5,
            prompt_tokens: 100,
            prompt_tokens_details: { cached_tokens: 80 },
            total_tokens: 105,
          },
        },
      });
      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
      } as any);

      const response = await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'private-model-id',
          stream: false,
        },
        { cacheDiagnostics },
      );

      expect(events.map((event) => event.type)).toEqual(['request', 'usage']);
      await response.text();
      expect(events.map((event) => event.type)).toEqual(['request', 'usage']);
    });

    it('should emit one terminal cache event for a raw mid-stream failure', async () => {
      const events: ModelCacheDiagnosticEvent[] = [];
      const cacheDiagnostics: ModelCacheDiagnosticContext = {
        emit: (event) => events.push(event),
        fingerprint: (scope) => `${scope}-fingerprint`,
        provider: ModelProvider.AzureAI,
        runtimeFamily: 'azure-ai',
      };
      const streamError = new Error('private mid-stream failure');
      let pullCount = 0;
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"hello"},"index":0}]}\n\n',
              ),
            );
            return;
          }

          controller.error(streamError);
        },
      });
      const mockPost = vi.fn().mockReturnValue({
        asBrowserStream: vi.fn().mockResolvedValue({ body: source }),
      });
      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
      } as any);

      const response = await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'private-model-id',
          stream: true,
        },
        { cacheDiagnostics },
      );

      await expect(response.text()).rejects.toBe(streamError);
      expect(events.map((event) => event.type)).toEqual(['request', 'terminal_error']);
      expect(JSON.stringify(events)).not.toContain('private mid-stream failure');
    });

    it('should handle generic errors', async () => {
      const mockError = new Error('Network error');

      const mockPost = vi.fn().mockRejectedValue(mockError);

      vi.spyOn(instance.client, 'path').mockReturnValue({
        post: mockPost,
      } as any);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
        });
      } catch (error: any) {
        expect(error.errorType).toBe(AgentRuntimeErrorType.AgentRuntimeError);
        expect(error.provider).toBe(ModelProvider.AzureAI);
      }
    });
  });

  describe('maskSensitiveUrl', () => {
    it('should mask subdomain in Azure URL', () => {
      const instance = new LobeAzureAI({
        apiKey: 'test-key',
        baseURL: 'https://myresource.cognitiveservices.azure.com/openai',
      });

      const masked = (instance as any).maskSensitiveUrl(
        'https://myresource.cognitiveservices.azure.com/openai',
      );
      expect(masked).toBe('https://***.cognitiveservices.azure.com/openai');
    });
  });
});
