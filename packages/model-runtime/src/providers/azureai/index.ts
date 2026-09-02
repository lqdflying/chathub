import createClient, { ModelClient } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import { repairOpenAIChatToolMessageSequence } from '@lobechat/utils';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import { systemToUserModels } from '../../const/models';
import { LobeRuntimeAI } from '../../core/BaseAI';
import {
  createModelCacheDiagnosticCallbacks,
  emitModelCacheRequest,
  emitModelCacheTerminalError,
} from '../../core/cacheDiagnostics';
import { transformResponseToStream } from '../../core/openaiCompatibleFactory';
import { OpenAIStream, createSSEDataExtractor } from '../../core/streams';
import { convertOpenAIUsage } from '../../core/usageConverters';
import { mergeMultipleChatMethodOptions } from '../../helpers';
import { ChatMethodOptions, ChatStreamPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { createDebugStreamTransformer } from '../../utils/debugStream';
import { StreamingResponse, createErrorAwareStream } from '../../utils/response';
import { sanitizeError } from '../../utils/sanitizeError';

interface AzureAIParams {
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
}

export class LobeAzureAI implements LobeRuntimeAI {
  client: ModelClient;

  constructor(params?: AzureAIParams) {
    if (!params?.apiKey || !params?.baseURL)
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.client = createClient(params?.baseURL, new AzureKeyCredential(params?.apiKey));

    this.baseURL = params?.baseURL;
  }

  baseURL: string;

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    let cacheRequestHash: string | undefined;
    const { messages, model, temperature, top_p, ...params } = payload;
    delete params.catalogModel;
    delete (params as ChatStreamPayload & { debugToolCache?: unknown }).debugToolCache;
    delete params.openAICompatCache;
    delete params.openAICompatResponsesParams;
    delete params.provider;
    delete params.responseMode;
    delete params.responseStateMode;
    // o1 series models on Azure OpenAI does not support streaming currently
    const enableStreaming = model.includes('o1') ? false : (params.stream ?? true);

    const updatedMessages = repairOpenAIChatToolMessageSequence(messages).map((message) => {
      const sanitizedMessage = { ...message } as typeof message & {
        id?: string;
        parentId?: string;
      };
      delete sanitizedMessage.id;
      delete sanitizedMessage.parentId;

      return {
        ...sanitizedMessage,
        role:
          // Convert 'system' role to 'user' or 'developer' based on the model
          (model.includes('o1') || model.includes('o3')) && message.role === 'system'
            ? [...systemToUserModels].some((sub) => model.includes(sub))
              ? 'user'
              : 'developer'
            : message.role,
      };
    });

    try {
      cacheRequestHash = emitModelCacheRequest(options?.cacheDiagnostics, {
        apiType: 'azure-ai-inference',
        cacheMechanism: 'passive',
        cachePolicy: {},
        cacheSupport: 'unobservable',
        inputItemCount: updatedMessages.length,
        model,
        requestFingerprintSource: {
          messages: updatedMessages,
          model,
          tools: params.tools,
        },
        stream: enableStreaming,
        toolCount: params.tools?.length ?? 0,
      });
      const cacheDiagnosticCallbacks = createModelCacheDiagnosticCallbacks(
        options?.cacheDiagnostics,
        {
          apiType: 'azure-ai-inference',
          cacheSupport: 'unobservable',
          requestHash: cacheRequestHash,
        },
      );
      const callbacks = cacheDiagnosticCallbacks
        ? mergeMultipleChatMethodOptions([
            { callback: options?.callback },
            { callback: cacheDiagnosticCallbacks },
          ]).callback
        : options?.callback;
      const requestPayload = {
        messages: updatedMessages as OpenAI.ChatCompletionMessageParam[],
        model,
        ...params,
        stream: enableStreaming,
        temperature: model.includes('o3') || model.includes('o4') ? undefined : temperature,
        tool_choice: params.tools ? 'auto' : undefined,
        top_p: model.includes('o3') || model.includes('o4') ? undefined : top_p,
      };
      await options?.onRequestPrepared?.(requestPayload, { apiMode: 'chatCompletion' });
      const response = this.client.path('/chat/completions').post({
        body: requestPayload,
      });

      if (enableStreaming) {
        const stream = await response.asBrowserStream();
        const diagnosticStream = cacheDiagnosticCallbacks?.onError
          ? createErrorAwareStream(stream.body!, cacheDiagnosticCallbacks.onError)
          : stream.body!;
        const responseStream =
          process.env.DEBUG_AZURE_AI_CHAT_COMPLETION === '1'
            ? diagnosticStream.pipeThrough(createDebugStreamTransformer())
            : diagnosticStream;

        return StreamingResponse(
          OpenAIStream(responseStream.pipeThrough(createSSEDataExtractor()), {
            callbacks,
            payload: {
              cacheDiagnostics: options?.cacheDiagnostics,
              cacheRequestHash,
              model,
              provider: ModelProvider.AzureAI,
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
        const res = await response;
        const completion = res.body as OpenAI.ChatCompletion;

        // the azure AI inference response is openai compatible
        await cacheDiagnosticCallbacks?.onFinal?.({
          text: '',
          usage: completion.usage ? convertOpenAIUsage(completion.usage) : undefined,
        });
        const stream = transformResponseToStream(completion);
        return StreamingResponse(
          OpenAIStream(stream, {
            callbacks,
            enableStreaming: false,
            payload: {
              cacheDiagnostics: options?.cacheDiagnostics,
              cacheRequestHash,
              model,
              provider: ModelProvider.AzureAI,
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
        apiType: 'azure-ai-inference',
        error: e,
        requestHash: cacheRequestHash,
      });
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
        provider: ModelProvider.AzureAI,
      });
    }
  }

  private maskSensitiveUrl = (url: string) => {
    // 使用正则表达式匹配 'https://' 后面和 '.azure.com/' 前面的内容
    const regex = /^(https:\/\/)([^.]+)(\.cognitiveservices\.azure\.com\/.*)$/;

    // 使用替换函数
    return url.replace(regex, (match, protocol, subdomain, rest) => {
      // 将子域名替换为 '***'
      return `${protocol}***${rest}`;
    });
  };
}
