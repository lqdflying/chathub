import { repairOpenAIChatToolMessageSequence } from '@lobechat/utils';
import debug from 'debug';
import { ModelProvider } from 'model-bank';
import OpenAI, { AzureOpenAI } from 'openai';
import type { Stream } from 'openai/streaming';

import { systemToUserModels } from '../../const/models';
import { LobeRuntimeAI } from '../../core/BaseAI';
import {
  createModelCacheDiagnosticCallbacks,
  emitModelCacheRequest,
  emitModelCacheTerminalError,
  supportsTrustedPromptCacheKey,
} from '../../core/cacheDiagnostics';
import { convertImageUrlToFile, convertOpenAIMessages } from '../../core/contextBuilders/openai';
import { transformResponseToStream } from '../../core/openaiCompatibleFactory';
import { OpenAIStream, tapAsyncIterable } from '../../core/streams';
import { convertOpenAIUsage } from '../../core/usageConverters';
import { mergeMultipleChatMethodOptions } from '../../helpers';
import {
  ChatMethodOptions,
  ChatStreamPayload,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { StreamingResponse } from '../../utils/response';
import { sanitizeError } from '../../utils/sanitizeError';

const azureImageLogger = debug('lobe-image:azure');

const supportsStreamingUsage = (apiVersion: string | undefined): boolean => {
  if (apiVersion === 'v1') return true;

  const versionDate = apiVersion?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return versionDate !== undefined && versionDate >= '2024-08-01';
};

export class LobeAzureOpenAI implements LobeRuntimeAI {
  client: AzureOpenAI;
  private apiVersion?: string;

  constructor(params: { apiKey?: string; apiVersion?: string; baseURL?: string } = {}) {
    if (!params.apiKey || !params.baseURL)
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.client = new AzureOpenAI({
      apiKey: params.apiKey,
      apiVersion: params.apiVersion,
      dangerouslyAllowBrowser: true,
      endpoint: params.baseURL,
    });

    this.apiVersion = params.apiVersion;
    this.baseURL = params.baseURL;
  }

  baseURL: string;

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    let cacheRequestHash: string | undefined;
    const { messages, model, ...params } = payload;
    delete params.catalogModel;
    delete (params as ChatStreamPayload & { debugToolCache?: unknown }).debugToolCache;
    delete params.openAICompatCache;
    delete params.openAICompatResponsesParams;
    delete params.prompt_cache_key;
    delete params.provider;
    delete params.responseStateMode;
    // o1 series models on Azure OpenAI does not support streaming currently
    const enableStreaming = model.includes('o1') ? false : (params.stream ?? true);

    const updatedMessages = repairOpenAIChatToolMessageSequence(messages).map((message) => ({
      ...message,
      role:
        // Convert 'system' role to 'user' or 'developer' based on the model
        (model.includes('o1') || model.includes('o3')) && message.role === 'system'
          ? [...systemToUserModels].some((sub) => model.includes(sub))
            ? 'user'
            : 'developer'
          : message.role,
    }));

    try {
      // Create parameters with proper typing for OpenAI SDK, handling reasoning_effort compatibility
      const { reasoning_effort, ...otherParams } = params;

      // Convert 'minimal' to 'low' for OpenAI SDK compatibility
      const compatibleReasoningEffort = reasoning_effort === 'minimal' ? 'low' : reasoning_effort;
      const trustedPromptCacheKey =
        options?.trustedCatalogModel &&
        supportsTrustedPromptCacheKey(options.trustedCatalogModel) &&
        options.trustedPromptCacheKey
          ? options.trustedPromptCacheKey
          : undefined;

      const baseParams = {
        messages: await convertOpenAIMessages(
          updatedMessages as OpenAI.ChatCompletionMessageParam[],
        ),
        model,
        ...otherParams,
        max_completion_tokens: undefined,
        ...(trustedPromptCacheKey ? { prompt_cache_key: trustedPromptCacheKey } : {}),
        tool_choice: params.tools ? ('auto' as const) : undefined,
      };
      cacheRequestHash = emitModelCacheRequest(options?.cacheDiagnostics, {
        apiType: 'chat-completions',
        cacheMechanism: trustedPromptCacheKey ? 'request-key' : 'automatic',
        cachePolicy: { promptCacheKey: !!trustedPromptCacheKey },
        cacheSupport: 'supported',
        inputItemCount: updatedMessages.length,
        model,
        requestFingerprintSource: {
          messages: baseParams.messages,
          model,
          tools: baseParams.tools,
        },
        stream: enableStreaming,
        toolCount: baseParams.tools?.length ?? 0,
      });
      const cacheDiagnosticCallbacks = createModelCacheDiagnosticCallbacks(
        options?.cacheDiagnostics,
        {
          apiType: 'chat-completions',
          cacheSupport: 'supported',
          requestHash: cacheRequestHash,
        },
      );
      const callbacks = cacheDiagnosticCallbacks
        ? mergeMultipleChatMethodOptions([
            { callback: options?.callback },
            { callback: cacheDiagnosticCallbacks },
          ]).callback
        : options?.callback;

      // Add reasoning_effort only if it exists and cast to proper type
      const openaiParams = compatibleReasoningEffort
        ? {
            ...baseParams,
            reasoning_effort: compatibleReasoningEffort as 'low' | 'medium' | 'high',
          }
        : baseParams;

      const requestPayload = enableStreaming
        ? {
            ...openaiParams,
            stream: true as const,
            ...(supportsStreamingUsage(this.apiVersion)
              ? { stream_options: { include_usage: true } }
              : {}),
          }
        : { ...openaiParams, stream: false as const };
      await options?.onRequestPrepared?.(requestPayload, { apiMode: 'chatCompletion' });
      const response = await this.client.chat.completions.create(requestPayload);
      if (enableStreaming) {
        let stream = response as Stream<OpenAI.ChatCompletionChunk>;
        if (process.env.DEBUG_AZURE_CHAT_COMPLETION === '1') {
          stream = tapAsyncIterable(stream, (chunk) => {
            console.log(JSON.stringify(chunk));
          });
        }
        return StreamingResponse(
          OpenAIStream(stream, {
            callbacks,
            payload: {
              cacheDiagnostics: options?.cacheDiagnostics,
              cacheRequestHash,
              model,
              provider: ModelProvider.Azure,
            },
          }),
          {
            headers: options?.headers,
            onCancel: async (reason) => {
              await Promise.allSettled([
                callbacks?.onCancel?.(reason),
                cacheDiagnosticCallbacks?.onError?.(reason),
              ]);
            },
          },
        );
      } else {
        await cacheDiagnosticCallbacks?.onFinal?.({
          text: '',
          usage: (response as OpenAI.ChatCompletion).usage
            ? convertOpenAIUsage((response as OpenAI.ChatCompletion).usage!)
            : undefined,
        });
        const stream = transformResponseToStream(response as OpenAI.ChatCompletion);
        return StreamingResponse(
          OpenAIStream(stream, {
            callbacks,
            enableStreaming: false,
            payload: {
              cacheDiagnostics: options?.cacheDiagnostics,
              cacheRequestHash,
              model,
              provider: ModelProvider.Azure,
            },
          }),
          {
            headers: options?.headers,
            onCancel: callbacks?.onCancel,
          },
        );
      }
    } catch (e) {
      emitModelCacheTerminalError(options?.cacheDiagnostics, {
        apiType: 'chat-completions',
        error: e,
        requestHash: cacheRequestHash,
      });
      return this.handleError(e, model);
    }
  }

  async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions): Promise<Embeddings[]> {
    try {
      const res = await this.client.embeddings.create(
        { ...payload, encoding_format: 'float', user: options?.user },
        { headers: options?.headers, signal: options?.signal },
      );

      return res.data.map((item) => item.embedding);
    } catch (error) {
      return this.handleError(error, payload.model);
    }
  }

  // Create image using Azure OpenAI Images API (gpt-image-1 or DALL·E deployments)
  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    const { model, params } = payload;
    azureImageLogger('Creating image with model: %s and params: %O', model, params);

    try {
      // Clone params and remap imageUrls/imageUrl -> image
      const userInput: Record<string, any> = { ...params };

      // Convert imageUrls to 'image' for edit API
      if (Array.isArray(userInput.imageUrls) && userInput.imageUrls.length > 0) {
        const imageFiles = await Promise.all(
          userInput.imageUrls.map((url: string) => convertImageUrlToFile(url)),
        );
        userInput.image = imageFiles.length === 1 ? imageFiles[0] : imageFiles;
      }

      // Backward compatibility: single imageUrl -> image
      if (userInput.imageUrl && !userInput.image) {
        userInput.image = await convertImageUrlToFile(userInput.imageUrl);
      }

      // Remove non-API parameters to avoid unknown_parameter errors
      delete userInput.imageUrls;
      delete userInput.imageUrl;

      const isImageEdit = Boolean(userInput.image);

      azureImageLogger('Is Image Edit: ' + isImageEdit);
      // Azure/OpenAI Images: remove unsupported/auto values where appropriate
      if (userInput.size === 'auto') delete userInput.size;

      // Build options: do not force response_format for gpt-image-1
      const options: any = {
        model,
        n: 1,
        ...(isImageEdit ? { input_fidelity: 'high' } : {}),
        ...userInput,
      };

      // For generate, ensure no 'image' field is sent
      if (!isImageEdit) delete options.image;

      // Call Azure Images API
      const img = isImageEdit
        ? await this.client.images.edit(options)
        : await this.client.images.generate(options);

      // Normalize possible string JSON response -- Sometimes Azure Image API returns a text/plain Content-Type
      let result: any = img as any;
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result);
        } catch {
          const truncated = result.length > 500 ? result.slice(0, 500) + '...[truncated]' : result;
          azureImageLogger(
            `Failed to parse string response from images API. Raw response: ${truncated}`,
          );
          throw new Error('Invalid image response: expected JSON string but parsing failed');
        }
      } else if (result && typeof result === 'object') {
        // Handle common Azure REST shapes
        if (typeof (result as any).bodyAsText === 'string') {
          try {
            result = JSON.parse((result as any).bodyAsText);
          } catch {
            const rawText = (result as any).bodyAsText;
            const truncated =
              rawText.length > 500 ? rawText.slice(0, 500) + '...[truncated]' : rawText;
            azureImageLogger(
              `Failed to parse bodyAsText from images API. Raw response: ${truncated}`,
            );
            throw new Error('Invalid image response: bodyAsText not valid JSON');
          }
        } else if (typeof (result as any).body === 'string') {
          try {
            result = JSON.parse((result as any).body);
          } catch {
            azureImageLogger('Failed to parse body from images API response');
            throw new Error('Invalid image response: body not valid JSON');
          }
        }
      }

      // Validate response
      if (!result || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
        throw new Error(
          `Invalid image response: missing or empty data array. Response: ${JSON.stringify(result)}`,
        );
      }

      const imageData: any = result.data[0];
      if (!imageData)
        throw new Error('Invalid image response: first data item is null or undefined');

      // Prefer base64 if provided, otherwise URL
      if (imageData.b64_json) {
        const mimeType = 'image/png';
        return { imageUrl: `data:${mimeType};base64,${imageData.b64_json}` };
      }

      if (imageData.url) {
        return { imageUrl: imageData.url };
      }

      throw new Error('Invalid image response: missing both b64_json and url fields');
    } catch (e) {
      return this.handleError(e, model);
    }
  }

  protected handleError(e: any, model?: string): never {
    let error = e as { [key: string]: any; code: string; message: string };

    if (error.code) {
      switch (error.code) {
        case 'DeploymentNotFound': {
          error = { ...error, deployId: model };
        }
      }
    } else {
      error = {
        cause: error.cause,
        message: error.message,
        name: error.name,
      } as any;
    }

    const errorType = error.code
      ? AgentRuntimeErrorType.ProviderBizError
      : AgentRuntimeErrorType.AgentRuntimeError;

    // Sanitize error to remove sensitive information like API keys from headers
    const sanitizedError = sanitizeError(error);

    throw AgentRuntimeError.chat({
      endpoint: this.maskSensitiveUrl(this.baseURL),
      error: sanitizedError,
      errorType,
      provider: ModelProvider.Azure,
    });
  }

  // Convert object keys to camel case, copy from `@azure/openai` in `node_modules/@azure/openai/dist/index.cjs`
  private camelCaseKeys = (obj: any): any => {
    if (typeof obj !== 'object' || !obj) return obj;
    if (Array.isArray(obj)) {
      return obj.map((v) => this.camelCaseKeys(v));
    } else {
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        const newKey = this.tocamelCase(key);
        if (newKey !== key) {
          delete obj[key];
        }
        obj[newKey] = typeof obj[newKey] === 'object' ? this.camelCaseKeys(value) : value;
      }
      return obj;
    }
  };

  private tocamelCase = (str: string) => {
    return str
      .toLowerCase()
      .replaceAll(/(_[a-z])/g, (group) => group.toUpperCase().replace('_', ''));
  };

  private maskSensitiveUrl = (url: string) => {
    // 使用正则表达式匹配 'https://' 后面和 '.openai.azure.com/' 前面的内容
    const regex = /^(https:\/\/)([^.]+)(\.openai\.azure\.com\/.*)$/;

    // 使用替换函数
    return url.replace(regex, (match, protocol, subdomain, rest) => {
      // 将子域名替换为 '***'
      return `${protocol}***${rest}`;
    });
  };
}
