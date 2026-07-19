import type { ChatModelCard } from '@lobechat/types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import debug from 'debug';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import type { AiModelType } from 'model-bank';
import OpenAI, { ClientOptions } from 'openai';
import { Stream } from 'openai/streaming';

import { responsesAPIModels } from '../../const/models';
import {
  ChatCompletionErrorPayload,
  ChatCompletionTool,
  ChatMethodOptions,
  ChatStreamCallbacks,
  ChatStreamPayload,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  TextToImagePayload,
  TextToSpeechOptions,
  TextToSpeechPayload,
} from '../../types';
import { AgentRuntimeErrorType, ILobeAgentRuntimeErrorType } from '../../types/error';
import { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { debugResponse } from '../../utils/debugStream';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { getModelPricing } from '../../utils/getModelPricing';
import { handleOpenAIError } from '../../utils/handleOpenAIError';
import { postProcessModelList } from '../../utils/postProcessModelList';
import { debugProviderRequest } from '../../utils/providerDebug';
import { SSE_HEARTBEAT_INTERVAL_MS, StreamingResponse } from '../../utils/response';
import { LobeRuntimeAI } from '../BaseAI';
import { convertOpenAIMessages, convertOpenAIResponseInputs } from '../contextBuilders/openai';
import { OpenAIResponsesStream, OpenAIStream, OpenAIStreamOptions } from '../streams';
import { createDeferredAsyncIterable, tapAsyncIterable } from '../streams/protocol';
import { createOpenAICompatibleImage } from './createImage';
import { transformResponseAPIToStream, transformResponseToStream } from './nonStreamToStream';
import { deriveCompatPromptCacheKey, normalizeOpenAICompatCacheUsage } from './openaicompatCache';
import {
  debugOpenAICompatCacheRequest,
  debugOpenAICompatCacheUsage,
  sanitizeToolCacheDebugMetadata,
} from './openaicompatDebug';

export * from './nonStreamToStream';

// the model contains the following keywords is not a chat model, so we should filter them out
export const CHAT_MODELS_BLOCK_LIST = [
  'embedding',
  'davinci',
  'curie',
  'moderation',
  'ada',
  'babbage',
  'tts',
  'whisper',
  'dall-e',
];

const openAICompatStoreValue = (store?: 'default' | 'false' | 'true') => {
  if (store === 'true') return true;
  if (store === 'false') return false;
  return undefined;
};

const shouldDebugOpenAICompatCache = (providerId?: string) =>
  providerId === 'openaicompatible' && process.env.DEBUG_OPENAICOMPATIBLE_CACHE === '1';

const recordValue = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

const applyOpenAICompatResponsesParams = (
  payload: Record<string, any>,
  params?: ChatStreamPayload['openAICompatResponsesParams'],
) => {
  if (!params) return payload;

  const next = { ...payload };
  const text = recordValue(next.text);
  const maxTokens = next.max_tokens;
  const maxOutputTokens = next.max_output_tokens ?? maxTokens;
  const verbosity = next.verbosity ?? text.verbosity;

  delete next.max_output_tokens;
  delete next.max_tokens;
  delete next.text;
  delete next.truncation;
  delete next.verbosity;

  if (params.maxTokens && maxTokens !== undefined) next.max_tokens = maxTokens;
  if (params.maxOutputTokens && maxOutputTokens !== undefined) {
    next.max_output_tokens = maxOutputTokens;
  }
  if (params.truncation && params.truncation !== 'off') next.truncation = params.truncation;

  const verbosityMode = params.verbosity || 'off';
  if (verbosityMode === 'text' || verbosityMode === 'both') {
    const textPayload = { ...text };
    if (verbosity !== undefined) textPayload.verbosity = verbosity;
    if (Object.keys(textPayload).length > 0) next.text = textPayload;
  }
  if ((verbosityMode === 'top-level' || verbosityMode === 'both') && verbosity !== undefined) {
    next.verbosity = verbosity;
  }

  return next;
};

type ConstructorOptions<T extends Record<string, any> = any> = ClientOptions & T;
export type CreateImageOptions = Omit<ClientOptions, 'apiKey' | 'provider'> & {
  apiKey: string;
  provider: string;
};

export interface CustomClientOptions<T extends Record<string, any> = any> {
  createChatCompletionStream?: (
    client: any,
    payload: ChatStreamPayload,
    instance: any,
  ) => ReadableStream<any>;
  createClient?: (options: ConstructorOptions<T>) => any;
}

export interface OpenAICompatibleFactoryOptions<T extends Record<string, any> = any> {
  apiKey?: string;
  baseURL?: string;
  chatCompletion?: {
    excludeUsage?: boolean;
    handleError?: (
      error: any,
      options: ConstructorOptions<T>,
    ) => Omit<ChatCompletionErrorPayload, 'provider'> | undefined;
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => OpenAI.ChatCompletionCreateParamsStreaming;
    handleStream?: (
      stream: Stream<OpenAI.ChatCompletionChunk> | ReadableStream,
      { callbacks, inputStartAt }: { callbacks?: ChatStreamCallbacks; inputStartAt?: number },
    ) => ReadableStream;
    handleStreamBizErrorType?: (error: {
      message: string;
      name: string;
    }) => ILobeAgentRuntimeErrorType | undefined;
    handleTransformResponseToStream?: (
      data: OpenAI.ChatCompletion,
    ) => ReadableStream<OpenAI.ChatCompletionChunk>;
    noUserId?: boolean;
    /**
     * If true, route chat requests to Responses API path directly
     */
    useResponse?: boolean;
    /**
     * Allow only some models to use Responses API by simple matching.
     * If any string appears in model id or RegExp matches, Responses API is used.
     */
    useResponseModels?: Array<string | RegExp>;
  };
  constructorOptions?: ConstructorOptions<T>;
  createImage?: (
    payload: CreateImagePayload,
    options: CreateImageOptions,
  ) => Promise<CreateImageResponse>;
  customClient?: CustomClientOptions<T>;
  debug?: {
    chatCompletion: () => boolean;
    responses?: () => boolean;
  };
  errorType?: {
    bizError: ILobeAgentRuntimeErrorType;
    invalidAPIKey: ILobeAgentRuntimeErrorType;
  };
  generateObject?: {
    /**
     * Transform schema before sending to the provider (e.g., filter unsupported properties)
     */
    handleSchema?: (schema: any) => any;
    /**
     * If true, route generateObject requests to Responses API path directly
     */
    useResponse?: boolean;
    /**
     * Allow only some models to use Responses API by simple matching.
     * If any string appears in model id or RegExp matches, Responses API is used.
     */
    useResponseModels?: Array<string | RegExp>;
    /**
     * Use tool calling to simulate structured output for providers that don't support native structured output
     */
    useToolsCalling?: boolean;
  };
  models?:
    | ((params: { client: OpenAI }) => Promise<ChatModelCard[]>)
    | {
        transformModel?: (model: OpenAI.Model) => ChatModelCard;
      };
  provider: string;
  responses?: {
    handlePayload?: (
      payload: ChatStreamPayload,
      options: ConstructorOptions<T>,
    ) => ChatStreamPayload;
  };
}

export const createOpenAICompatibleRuntime = <T extends Record<string, any> = any>({
  provider,
  baseURL: DEFAULT_BASE_URL,
  apiKey: DEFAULT_API_LEY,
  errorType,
  debug: debugParams,
  constructorOptions,
  chatCompletion,
  models,
  customClient,
  responses,
  createImage: customCreateImage,
  generateObject: generateObjectConfig,
}: OpenAICompatibleFactoryOptions<T>) => {
  const ErrorType = {
    bizError: errorType?.bizError || AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: errorType?.invalidAPIKey || AgentRuntimeErrorType.InvalidProviderAPIKey,
  };

  return class LobeOpenAICompatibleAI implements LobeRuntimeAI {
    client!: OpenAI;

    private id: string;
    private logPrefix: string;

    baseURL!: string;
    protected _options: ConstructorOptions<T>;

    constructor(options: ClientOptions & Record<string, any> = {}) {
      const _options = {
        ...options,
        apiKey:
          (typeof options.apiKey === 'string' ? options.apiKey.trim() : options.apiKey) ||
          DEFAULT_API_LEY,
        baseURL: options.baseURL?.trim() || DEFAULT_BASE_URL,
      };
      const { apiKey, baseURL = DEFAULT_BASE_URL, ...res } = _options;
      this._options = _options as ConstructorOptions<T>;

      if (!apiKey) throw AgentRuntimeError.createError(ErrorType?.invalidAPIKey);

      const initOptions = { apiKey, baseURL, ...constructorOptions, ...res };

      // if the custom client is provided, use it as client
      if (customClient?.createClient) {
        this.client = customClient.createClient(initOptions as any);
      } else {
        this.client = new OpenAI(initOptions);
      }

      this.baseURL = baseURL || this.client.baseURL;

      this.id = options.id || provider;
      this.logPrefix = `lobe-model-runtime:${this.id}`;
    }

    async chat({ responseMode, ...payload }: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        const log = debug(`${this.logPrefix}:chat`);
        const inputStartAt = Date.now();
        const debugOpenAICompatCache = shouldDebugOpenAICompatCache(this.id);

        log('chat called with model: %s, stream: %s', payload.model, payload.stream ?? true);

        // 工厂级 Responses API 路由控制（支持实例覆盖）
        const modelId = (payload as any).model as string | undefined;
        const shouldUseResponses = (() => {
          const instanceChat = ((this._options as any).chatCompletion || {}) as {
            useResponse?: boolean;
            useResponseModels?: Array<string | RegExp>;
          };
          const flagUseResponse =
            instanceChat.useResponse ?? (chatCompletion ? chatCompletion.useResponse : undefined);
          const flagUseResponseModels =
            instanceChat.useResponseModels ?? chatCompletion?.useResponseModels;

          if (!chatCompletion && !instanceChat) return false;
          if (flagUseResponse) return true;
          if (!modelId || !flagUseResponseModels?.length) return false;
          return flagUseResponseModels.some((m: string | RegExp) =>
            typeof m === 'string' ? modelId.includes(m) : (m as RegExp).test(modelId),
          );
        })();

        let processedPayload: any = payload;
        if (shouldUseResponses) {
          log('using Responses API mode');
          processedPayload = { ...payload, apiMode: 'responses' } as any;
        } else {
          log('using Chat Completions API mode');
        }

        // 再进行工厂级处理
        const postPayload = chatCompletion?.handlePayload
          ? chatCompletion.handlePayload(processedPayload, this._options)
          : ({
              ...processedPayload,
              stream: processedPayload.stream ?? true,
            } as OpenAI.ChatCompletionCreateParamsStreaming);

        if ((postPayload as any).apiMode === 'responses') {
          const responsePayload = { ...postPayload } as ChatStreamPayload & Record<string, any>;
          const runtimePayload = processedPayload as Record<string, any>;

          for (const key of [
            'openAICompatCache',
            'openAICompatResponsesParams',
            'responseStateMode',
          ] as const) {
            if (runtimePayload[key] !== undefined) responsePayload[key] = runtimePayload[key];
          }
          if (
            responsePayload.prompt_cache_key === undefined &&
            runtimePayload.prompt_cache_key !== undefined
          ) {
            responsePayload.prompt_cache_key = runtimePayload.prompt_cache_key;
          }
          if (responsePayload.store === undefined && runtimePayload.store !== undefined) {
            responsePayload.store = runtimePayload.store;
          }

          return this.handleResponseAPIMode(responsePayload, options);
        }

        const chatCompletionPayload = { ...postPayload } as typeof postPayload & {
          apiMode?: string;
          debugToolCache?: ChatStreamPayload['debugToolCache'];
          openAICompatCache?: ChatStreamPayload['openAICompatCache'];
          openAICompatResponsesParams?: ChatStreamPayload['openAICompatResponsesParams'];
        };
        delete chatCompletionPayload.apiMode;
        const requestedToolCache = sanitizeToolCacheDebugMetadata(
          chatCompletionPayload.debugToolCache,
        );
        delete chatCompletionPayload.debugToolCache;
        delete chatCompletionPayload.openAICompatCache;
        delete chatCompletionPayload.openAICompatResponsesParams;

        const messages = await convertOpenAIMessages(chatCompletionPayload.messages, this.id);
        const openAICompatCache = payload.openAICompatCache || processedPayload.openAICompatCache;
        const chatCache = openAICompatCache?.chat;
        const explicitChatCacheKey =
          typeof (chatCompletionPayload as any).prompt_cache_key === 'string'
            ? (chatCompletionPayload as any).prompt_cache_key
            : '';
        const derivedChatCacheKey =
          !explicitChatCacheKey && (chatCache?.promptCacheKey || chatCache?.sessionHeader)
            ? await deriveCompatPromptCacheKey(
                { ...chatCompletionPayload, messages, model: payload.model },
                payload.model,
                // This branch only fires on explicit `openAICompatCache.chat`
                // config, so the key must be derived for any model — the
                // gpt-5/codex allowlist only guards implicit injection.
                { bypassModelAllowlist: true },
              )
            : '';
        const chatCacheKey = explicitChatCacheKey || derivedChatCacheKey;
        const debugToolCache = requestedToolCache
          ? {
              ...requestedToolCache,
              cachePolicy: {
                chatPromptCacheKey: !!(chatCache?.promptCacheKey && chatCacheKey),
                chatSessionHeader: !!(chatCache?.sessionHeader && chatCacheKey),
              },
              inputItemCount: messages.length,
            }
          : undefined;

        let response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
        let requestHash: string | undefined;

        const streamOptions: OpenAIStreamOptions = {
          bizErrorTypeTransformer: chatCompletion?.handleStreamBizErrorType,
          callbacks: options?.callback,
          payload: {
            debugOpenAICompatCache,
            debugToolCache,
            model: payload.model,
            openAICompatRequestHash: requestHash,
            pricing: await getModelPricing(payload.model, this.id),
            provider: this.id,
          },
        };

        if (customClient?.createChatCompletionStream) {
          log('using custom client for chat completion stream');
          response = customClient.createChatCompletionStream(
            this.client,
            processedPayload,
            this,
          ) as any;
        } else {
          const finalPayload = {
            ...chatCompletionPayload,
            ...(chatCache?.promptCacheKey && chatCacheKey
              ? { prompt_cache_key: chatCacheKey }
              : {}),
            messages,
            ...(chatCompletion?.noUserId ? {} : { user: options?.user }),
            stream_options:
              chatCompletionPayload.stream && !chatCompletion?.excludeUsage
                ? { include_usage: true }
                : undefined,
          };
          const requestHeaders = {
            Accept: '*/*',
            ...options?.requestHeaders,
            ...(chatCache?.sessionHeader && chatCacheKey ? { Session_id: chatCacheKey } : {}),
          };

          log('sending chat completion request with %d messages', messages.length);

          if (debugOpenAICompatCache) {
            requestHash = debugOpenAICompatCacheRequest({
              baseURL: this.baseURL,
              debugToolCache,
              headers: requestHeaders,
              payload: finalPayload,
              route: '/chat/completions',
            });
            if (streamOptions.payload) {
              streamOptions.payload.openAICompatRequestHash = requestHash;
            }
          }

          if (debugParams?.chatCompletion?.()) {
            debugProviderRequest({
              baseURL: this.baseURL,
              payload: finalPayload,
              provider: this.id,
              route: '/chat/completions',
            });
            console.log('[requestPayload]');
            console.log(JSON.stringify(finalPayload), '\n');
          }

          if (chatCompletionPayload.stream) {
            response = createDeferredAsyncIterable<OpenAI.ChatCompletionChunk>(async (signal) => {
              try {
                return (await this.client.chat.completions.create(finalPayload, {
                  // https://github.com/lobehub/lobe-chat/pull/318
                  headers: requestHeaders,
                  signal,
                })) as Stream<OpenAI.ChatCompletionChunk>;
              } catch (error) {
                throw this.handleError(error);
              }
            }, options?.signal) as Stream<OpenAI.ChatCompletionChunk>;
          } else {
            response = await this.client.chat.completions.create(finalPayload, {
              // https://github.com/lobehub/lobe-chat/pull/318
              headers: requestHeaders,
              signal: options?.signal,
            });
          }
        }

        if (chatCompletionPayload.stream) {
          log('processing streaming response');
          // Pass the raw SDK Stream directly (NO `tee()`). tee() splits the
          // stream into two independent iterators but the debug branch lacks
          // `return()` forwarding, so downstream cancellation (AbortController)
          // does not propagate upstream and the unread debug branch retains
          // queued results in memory. A single owned iterator (created inside
          // OpenAIStream / handleStream via convertIterableToStream) keeps
          // cancellation intact. Debug observation wraps that same iterable via
          // tapAsyncIterable, which forwards `return()` to the underlying
          // iterator.
          let prodStream: Stream<OpenAI.ChatCompletionChunk> | ReadableStream =
            response as Stream<OpenAI.ChatCompletionChunk>;

          if (debugParams?.chatCompletion?.()) {
            prodStream = tapAsyncIterable(prodStream, (chunk) => {
              console.log(JSON.stringify(chunk));
            });
          }

          return StreamingResponse(
            chatCompletion?.handleStream
              ? chatCompletion.handleStream(prodStream, {
                  callbacks: streamOptions.callbacks,
                  inputStartAt,
                })
              : OpenAIStream(prodStream, {
                  ...streamOptions,
                  inputStartAt,
                }),
            {
              headers: options?.headers,
              heartbeatIntervalMs: SSE_HEARTBEAT_INTERVAL_MS,
            },
          );
        }

        if (debugParams?.chatCompletion?.()) {
          debugResponse(response);
        }

        if (responseMode === 'json') {
          log('returning JSON response mode');
          return Response.json(response);
        }

        log('transforming non-streaming response to stream');
        const transformHandler =
          chatCompletion?.handleTransformResponseToStream || transformResponseToStream;
        const stream = transformHandler(response as unknown as OpenAI.ChatCompletion);

        return StreamingResponse(
          chatCompletion?.handleStream
            ? chatCompletion.handleStream(stream, {
                callbacks: streamOptions.callbacks,
                inputStartAt,
              })
            : OpenAIStream(stream, { ...streamOptions, enableStreaming: false, inputStartAt }),
          {
            headers: options?.headers,
          },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async createImage(payload: CreateImagePayload) {
      const log = debug(`${this.logPrefix}:createImage`);

      // If custom createImage implementation is provided, use it
      if (customCreateImage) {
        log('using custom createImage implementation');
        return customCreateImage(payload, {
          ...this._options,
          apiKey: this._options.apiKey as string,
          provider,
        });
      }

      log('using default createOpenAICompatibleImage');
      // Use the new createOpenAICompatibleImage function
      return createOpenAICompatibleImage(this.client, payload, this.id);
    }

    async models() {
      const log = debug(`${this.logPrefix}:models`);
      log('fetching available models');

      let resultModels: ChatModelCard[] = [];
      if (typeof models === 'function') {
        log('using custom models function');
        resultModels = await models({ client: this.client });
      } else {
        log('fetching models from client API');
        const list = await this.client.models.list();
        resultModels = list.data
          .filter((model) => {
            return CHAT_MODELS_BLOCK_LIST.every(
              (keyword) => !model.id.toLowerCase().includes(keyword),
            );
          })
          .map((item) => {
            if (models?.transformModel) {
              return models.transformModel(item);
            }

            const toReleasedAt = () => {
              if (!item.created) return;
              dayjs.extend(utc);

              // guarantee item.created in Date String format
              if (
                typeof (item.created as any) === 'string' ||
                // or in milliseconds
                item.created.toFixed(0).length === 13
              ) {
                return dayjs.utc(item.created).format('YYYY-MM-DD');
              }

              // by default, the created time is in seconds
              return dayjs.utc(item.created * 1000).format('YYYY-MM-DD');
            };

            // TODO: should refactor after remove v1 user/modelList code
            const knownModel = LOBE_DEFAULT_MODEL_LIST.find((model) => model.id === item.id);

            if (knownModel) {
              const releasedAt = knownModel.releasedAt ?? toReleasedAt();

              return { ...knownModel, releasedAt };
            }

            return {
              id: item.id,
              releasedAt: toReleasedAt(),
            };
          })

          .filter(Boolean) as ChatModelCard[];
      }

      log('fetched %d models', resultModels.length);

      return await postProcessModelList(resultModels, (modelId) =>
        getModelPropertyWithFallback<AiModelType>(modelId, 'type'),
      );
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      const { messages, schema, model, responseApi, tools } = payload;

      const log = debug(`${this.logPrefix}:generateObject`);
      log(
        'generateObject called with model: %s, hasTools: %s, hasSchema: %s',
        model,
        !!tools,
        !!schema,
      );

      if (tools) {
        log('using tools-based generation');
        return this.generateObjectWithTools(payload, options);
      }

      if (!schema) throw new Error('tools or schema is required');

      // Use tool calling fallback if configured
      if (generateObjectConfig?.useToolsCalling) {
        log('using tool calling fallback for structured output');

        // Apply schema transformation if configured
        const processedSchema = generateObjectConfig.handleSchema
          ? { ...schema, schema: generateObjectConfig.handleSchema(schema.schema) }
          : schema;

        const tool: ChatCompletionTool = {
          function: {
            description:
              processedSchema.description ||
              'Generate structured output according to the provided schema',
            name: processedSchema.name || 'structured_output',
            parameters: processedSchema.schema,
          },
          type: 'function',
        };

        const res = await this.client.chat.completions.create(
          {
            messages,
            model,
            tool_choice: { function: { name: tool.function.name }, type: 'function' },
            tools: [tool],
            user: options?.user,
          },
          { headers: options?.headers, signal: options?.signal },
        );

        const toolCalls = res.choices[0].message.tool_calls!;

        try {
          return (toolCalls as OpenAI.ChatCompletionMessageFunctionToolCall[]).map((item) => ({
            arguments: JSON.parse(item.function.arguments),
            name: item.function.name,
          }));
        } catch {
          console.error('parse tool call arguments error:', toolCalls);
          return undefined;
        }
      }

      // Factory-level Responses API routing control (supports instance override)
      const shouldUseResponses = (() => {
        const instanceGenerateObject = ((this._options as any).generateObject || {}) as {
          useResponse?: boolean;
          useResponseModels?: Array<string | RegExp>;
        };
        const flagUseResponse =
          instanceGenerateObject.useResponse ??
          (generateObjectConfig ? generateObjectConfig.useResponse : undefined);
        const flagUseResponseModels =
          instanceGenerateObject.useResponseModels ?? generateObjectConfig?.useResponseModels;

        if (responseApi) {
          log('using Responses API due to explicit responseApi flag');
          return true;
        }

        if (flagUseResponse) {
          log('using Responses API due to useResponse flag');
          return true;
        }

        // Use factory-configured model list if provided
        if (model && flagUseResponseModels?.length) {
          const matches = flagUseResponseModels.some((m: string | RegExp) =>
            typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
          );
          if (matches) {
            log('using Responses API: model %s matches useResponseModels config', model);
            return true;
          }
        }

        // Default: use built-in responsesAPIModels
        if (model && responsesAPIModels.has(model)) {
          log('using Responses API: model %s in built-in responsesAPIModels', model);
          return true;
        }

        log('using Chat Completions API for generateObject');
        return false;
      })();

      // Apply schema transformation if configured
      const processedSchema = generateObjectConfig?.handleSchema
        ? { ...schema, schema: generateObjectConfig.handleSchema(schema.schema) }
        : schema;

      if (shouldUseResponses) {
        log('calling responses.create for structured output');
        const res = await this.client!.responses.create(
          {
            input: messages,
            model,
            text: { format: { strict: true, type: 'json_schema', ...processedSchema } },
            user: options?.user,
          },
          { headers: options?.headers, signal: options?.signal },
        );

        const text = res.output_text;
        log('received structured output from Responses API, length: %d', text?.length || 0);
        try {
          const result = JSON.parse(text);
          log('successfully parsed JSON output');
          return result;
        } catch (error) {
          log('failed to parse JSON output: %O', error);
          console.error('parse json error:', text);
          return undefined;
        }
      }

      log('calling chat.completions.create for structured output');
      const res = await this.client.chat.completions.create(
        {
          messages,
          model,
          response_format: { json_schema: processedSchema, type: 'json_schema' },
          user: options?.user,
        },
        { headers: options?.headers, signal: options?.signal },
      );
      const text = res.choices[0].message.content!;

      log('received structured output from Chat Completions API, length: %d', text?.length || 0);

      try {
        const result = JSON.parse(text);
        log('successfully parsed JSON output');
        return result;
      } catch (error) {
        log('failed to parse JSON output: %O', error);
        console.error('parse json error:', text);
        return undefined;
      }
    }

    async embeddings(
      payload: EmbeddingsPayload,
      options?: EmbeddingsOptions,
    ): Promise<Embeddings[]> {
      const log = debug(`${this.logPrefix}:embeddings`);
      log(
        'embeddings called with model: %s, input items: %d',
        payload.model,
        Array.isArray(payload.input) ? payload.input.length : 1,
      );

      try {
        const res = await this.client.embeddings.create(
          { ...payload, encoding_format: 'float', user: options?.user },
          { headers: options?.headers, signal: options?.signal },
        );

        log('received %d embeddings', res.data.length);
        return res.data.map((item) => item.embedding);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async textToImage(payload: TextToImagePayload) {
      const log = debug(`${this.logPrefix}:textToImage`);
      log('textToImage called with prompt length: %d', payload.prompt?.length || 0);

      try {
        const res = await this.client.images.generate(payload);
        log('generated %d images', res.data?.length || 0);
        return (res.data || []).map((o) => o.url) as string[];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
      const log = debug(`${this.logPrefix}:textToSpeech`);
      log(
        'textToSpeech called with input length: %d, voice: %s',
        payload.input?.length || 0,
        payload.voice,
      );

      try {
        const mp3 = await this.client.audio.speech.create(payload as any, {
          headers: options?.headers,
          signal: options?.signal,
        });
        const buffer = await mp3.arrayBuffer();
        log('generated audio with size: %d bytes', buffer.byteLength);
        return buffer;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    protected handleError(error: any): ChatCompletionErrorPayload {
      const log = debug(`${this.logPrefix}:error`);
      log('handling error: %O', error);

      let desensitizedEndpoint = this.baseURL;

      // refs: https://github.com/lobehub/lobe-chat/issues/842
      if (this.baseURL !== DEFAULT_BASE_URL) {
        desensitizedEndpoint = desensitizeUrl(this.baseURL);
      }

      if (chatCompletion?.handleError) {
        log('using custom error handler');
        const errorResult = chatCompletion.handleError(error, this._options);

        if (errorResult)
          return AgentRuntimeError.chat({
            ...errorResult,
            provider: this.id,
          } as ChatCompletionErrorPayload);
      }

      if ('status' in (error as any)) {
        const status = (error as Response).status;
        log('HTTP error with status: %d', status);

        switch (status) {
          case 401: {
            log('invalid API key error');
            return AgentRuntimeError.chat({
              endpoint: desensitizedEndpoint,
              error: error as any,
              errorType: ErrorType.invalidAPIKey,
              provider: this.id,
            });
          }

          default: {
            break;
          }
        }
      }

      const { errorResult, RuntimeError } = handleOpenAIError(error);

      log('error code: %s, message: %s', errorResult.code, errorResult.message);

      // Check for "Insufficient Balance" in error message
      const errorMessage = errorResult.error?.message || errorResult.message;
      if (errorMessage?.includes('Insufficient Balance')) {
        log('insufficient balance error detected in message');
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: errorResult,
          errorType: AgentRuntimeErrorType.InsufficientQuota,
          provider: this.id,
        });
      }

      switch (errorResult.code) {
        case 'insufficient_quota': {
          log('insufficient quota error');
          return AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: errorResult,
            errorType: AgentRuntimeErrorType.InsufficientQuota,
            provider: this.id,
          });
        }

        case 'model_not_found': {
          log('model not found error');
          return AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: errorResult,
            errorType: AgentRuntimeErrorType.ModelNotFound,
            provider: this.id,
          });
        }

        // content too long
        case 'context_length_exceeded':
        case 'string_above_max_length': {
          log('context length exceeded error');
          return AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: errorResult,
            errorType: AgentRuntimeErrorType.ExceededContextWindow,
            provider: this.id,
          });
        }
      }

      log('returning generic error');
      return AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: errorResult,
        errorType: RuntimeError || ErrorType.bizError,
        provider: this.id,
      });
    }

    private async handleResponseAPIMode(
      payload: ChatStreamPayload,
      options?: ChatMethodOptions,
    ): Promise<Response> {
      const log = debug(`${this.logPrefix}:handleResponseAPIMode`);
      log('handleResponseAPIMode called with model: %s', payload.model);

      const inputStartAt = Date.now();
      const debugOpenAICompatCache = shouldDebugOpenAICompatCache(this.id);

      const { messages, reasoning_effort, tools, reasoning, responseMode, ...res } =
        responses?.handlePayload
          ? (responses?.handlePayload(payload, this._options) as ChatStreamPayload)
          : payload;

      const responseStateMode = res.responseStateMode;
      const storeOverride = res.store;
      const requestedToolCache = sanitizeToolCacheDebugMetadata(res.debugToolCache);
      const responseCache = res.openAICompatCache?.responses;
      const responsesParams = res.openAICompatResponsesParams;
      const statefulResponses = !res.openAICompatCache && responseStateMode === 'provider';
      const responseCacheNeedsKey =
        responseCache?.promptCacheKey === 'derived' || responseCache?.sessionHeader;

      // remove penalty params
      delete res.apiMode;
      delete res.debugToolCache;
      delete res.frequency_penalty;
      delete res.openAICompatCache;
      delete res.openAICompatResponsesParams;
      delete res.presence_penalty;
      delete res.responseStateMode;
      delete res.store;

      // Normalize tool_choice to the Responses API shape so both the derived
      // prompt-cache key and the upstream request body agree on the form.
      const normalizedToolChoice = this.normalizeToolChoiceForResponses(
        (res as any).tool_choice ?? payload.tool_choice,
      );
      if (normalizedToolChoice) {
        (res as any).tool_choice = normalizedToolChoice;
      } else {
        delete (res as any).tool_choice;
      }

      const input = await convertOpenAIResponseInputs(messages as any, this.id);
      const responseParamsPayload = applyOpenAICompatResponsesParams(res, responsesParams);
      const effectiveReasoning =
        reasoning || reasoning_effort
          ? {
              ...reasoning,
              ...(reasoning_effort ? { effort: reasoning_effort } : {}),
            }
          : undefined;
      const responseTools = tools?.map((tool) =>
        this.convertChatCompletionToolToResponseTool(tool),
      );
      const explicitPromptCacheKey =
        typeof responseParamsPayload.prompt_cache_key === 'string'
          ? responseParamsPayload.prompt_cache_key
          : '';
      const derivedPromptCacheKey =
        !explicitPromptCacheKey && (statefulResponses || responseCacheNeedsKey)
          ? await deriveCompatPromptCacheKey(
              {
                ...responseParamsPayload,
                ...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
                input,
                model: payload.model,
                ...(responseTools ? { tools: responseTools } : {}),
              },
              payload.model,
              // Explicit matrix config (`promptCacheKey: 'derived'` or
              // `sessionHeader`) must derive for any model; the legacy
              // implicit `responseStateMode: 'provider'` path keeps the
              // gpt-5/codex allowlist.
              { bypassModelAllowlist: !!responseCacheNeedsKey },
            )
          : '';
      const promptCacheKey = explicitPromptCacheKey || derivedPromptCacheKey;
      const shouldSendPromptCacheKey =
        !!promptCacheKey &&
        (statefulResponses ||
          responseCache?.promptCacheKey === 'derived' ||
          !!explicitPromptCacheKey);
      const matrixStore = openAICompatStoreValue(responseCache?.store);
      const store =
        storeOverride !== undefined
          ? storeOverride
          : matrixStore !== undefined
            ? matrixStore
            : undefined;
      const debugToolCache = requestedToolCache
        ? {
            ...requestedToolCache,
            cachePolicy: {
              responsePromptCacheKey: shouldSendPromptCacheKey
                ? ('derived' as const)
                : ('off' as const),
              responseSessionHeader: !!(responseCache?.sessionHeader && promptCacheKey),
              responseStateMode: statefulResponses
                ? ('provider' as const)
                : ('stateless' as const),
              responseStore:
                store === undefined ? ('default' as const) : store ? ('true' as const) : ('false' as const),
            },
            inputItemCount: input.length,
          }
        : undefined;

      const isStreaming = payload.stream !== false;
      log(
        'isStreaming: %s, hasTools: %s, hasReasoning: %s',
        isStreaming,
        !!tools,
        !!(reasoning || reasoning_effort),
      );

      const postPayload = {
        ...responseParamsPayload,
        ...(shouldSendPromptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
        ...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
        input,
        ...(store !== undefined || statefulResponses ? { store: store ?? true } : {}),
        stream: !isStreaming ? undefined : isStreaming,
        tools: responseTools,
      } as OpenAI.Responses.ResponseCreateParamsStreaming | OpenAI.Responses.ResponseCreateParams;

      if (debugParams?.responses?.()) {
        console.log('[requestPayload]');
        console.log(JSON.stringify(postPayload), '\n');
      }

      log('sending responses.create request');
      const requestHeaders = {
        ...options?.requestHeaders,
        ...(responseCache?.sessionHeader && promptCacheKey ? { Session_id: promptCacheKey } : {}),
      };
      let requestHash: string | undefined;

      if (debugOpenAICompatCache) {
        requestHash = debugOpenAICompatCacheRequest({
          baseURL: this.baseURL,
          debugToolCache,
          headers: requestHeaders,
          payload: postPayload,
          route: '/responses',
        });
      }

      const streamOptions: OpenAIStreamOptions = {
        bizErrorTypeTransformer: chatCompletion?.handleStreamBizErrorType,
        callbacks: options?.callback,
        payload: {
          debugOpenAICompatCache,
          debugToolCache,
          model: payload.model,
          openAICompatRequestHash: requestHash,
          pricing: await getModelPricing(payload.model, this.id),
          provider: this.id,
        },
      };

      if (isStreaming) {
        log('processing streaming Responses API response');
        // Pass the raw SDK Stream directly (NO `tee()`). See the Chat
        // Completions branch above for the cancellation rationale.
        let prodStream: Stream<OpenAI.Responses.ResponseStreamEvent> | ReadableStream =
          createDeferredAsyncIterable<OpenAI.Responses.ResponseStreamEvent>(async (signal) => {
            try {
              return (await this.client.responses.create(postPayload, {
                headers: requestHeaders,
                signal,
              })) as Stream<OpenAI.Responses.ResponseStreamEvent>;
            } catch (error) {
              throw this.handleError(error);
            }
          }, options?.signal) as Stream<OpenAI.Responses.ResponseStreamEvent>;

        if (debugParams?.responses?.()) {
          prodStream = tapAsyncIterable(prodStream, (chunk) => {
            console.log(JSON.stringify(chunk));
          });
        }

        return StreamingResponse(
          OpenAIResponsesStream(
            prodStream,
            { ...streamOptions, inputStartAt },
            { requireTerminalEvent: true },
          ),
          {
            headers: options?.headers,
            heartbeatIntervalMs: SSE_HEARTBEAT_INTERVAL_MS,
          },
        );
      }

      log('processing non-streaming Responses API response');

      const response = await this.client.responses.create(postPayload, {
        headers: requestHeaders,
        signal: options?.signal,
      });

      // Handle non-streaming response
      if (debugParams?.responses?.()) {
        debugResponse(response);
      }

      const normalizedResponse = normalizeOpenAICompatCacheUsage(response).json;
      if (debugOpenAICompatCache) {
        const usage = (normalizedResponse as OpenAI.Responses.Response).usage;
        const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? null;

        if (usage) {
          debugOpenAICompatCacheUsage({
            model: payload.model,
            requestHash,
            route: '/responses',
            toolCache: debugToolCache,
            usage: {
              cacheMissTokens:
                cachedTokens === null || usage.input_tokens === undefined
                  ? null
                  : usage.input_tokens - cachedTokens,
              cachedTokens,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              responseId: (normalizedResponse as OpenAI.Responses.Response).id,
              totalTokens: usage.total_tokens,
            },
          });
        }
      }

      if (responseMode === 'json') {
        log('returning JSON response mode');
        return Response.json(normalizedResponse);
      }

      log('transforming non-streaming Responses API response to stream');
      const stream = transformResponseAPIToStream(normalizedResponse as OpenAI.Responses.Response);

      return StreamingResponse(
        OpenAIResponsesStream(
          stream,
          { ...streamOptions, enableStreaming: false, inputStartAt },
          { requireTerminalEvent: true },
        ),
        {
          headers: options?.headers,
        },
      );
    }

    private convertChatCompletionToolToResponseTool = (
      tool: ChatCompletionTool,
    ): OpenAI.Responses.Tool => {
      return { type: tool.type, ...tool.function } as any;
    };

    /**
     * Normalize a Chat Completions `tool_choice` value to the Responses API
     * shape. Chat Completions forced-function form is
     * `{ type: 'function', function: { name } }`; the Responses API expects the
     * flat `{ type: 'function', name }` form. String modes (`auto`/`none`/
     * `required`) pass through unchanged.
     */
    private normalizeToolChoiceForResponses = (
      toolChoice: ChatStreamPayload['tool_choice'],
    ):
      | OpenAI.Responses.Responses.ToolChoiceOptions
      | OpenAI.Responses.Responses.ToolChoiceFunction
      | undefined => {
      if (toolChoice === undefined || toolChoice === null) return undefined;

      if (typeof toolChoice === 'string')
        return toolChoice as OpenAI.Responses.Responses.ToolChoiceOptions;

      const tc = toolChoice as any;
      // Already in Responses form ({ type: 'function', name })
      if (tc.type === 'function' && typeof tc.name === 'string') {
        return { name: tc.name, type: 'function' };
      }
      // Chat Completions form ({ type: 'function', function: { name } })
      if (tc.type === 'function' && tc.function && typeof tc.function.name === 'string') {
        return { name: tc.function.name, type: 'function' };
      }

      return undefined;
    };

    private async generateObjectWithTools(
      payload: GenerateObjectPayload,
      options?: GenerateObjectOptions,
    ) {
      const { messages, model, tools, responseApi } = payload;
      const log = debug(`${this.logPrefix}:generateObject`);

      log(
        'generateObjectWithTools called with model: %s, toolsCount: %d',
        model,
        tools?.length || 0,
      );

      // Factory-level Responses API routing control (supports instance override)
      const shouldUseResponses = (() => {
        const instanceGenerateObject = ((this._options as any).generateObject || {}) as {
          useResponse?: boolean;
          useResponseModels?: Array<string | RegExp>;
        };
        const flagUseResponse =
          instanceGenerateObject.useResponse ??
          (generateObjectConfig ? generateObjectConfig.useResponse : undefined);
        const flagUseResponseModels =
          instanceGenerateObject.useResponseModels ?? generateObjectConfig?.useResponseModels;

        if (responseApi) {
          log('using Responses API due to explicit responseApi flag');
          return true;
        }

        if (flagUseResponse) {
          log('using Responses API due to useResponse flag');
          return true;
        }

        // Use factory-configured model list if provided
        if (model && flagUseResponseModels?.length) {
          const matches = flagUseResponseModels.some((m: string | RegExp) =>
            typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
          );
          if (matches) {
            log('using Responses API: model %s matches useResponseModels config', model);
            return true;
          }
        }

        // Default: use built-in responsesAPIModels
        if (model && responsesAPIModels.has(model)) {
          log('using Responses API: model %s in built-in responsesAPIModels', model);
          return true;
        }

        log('using Chat Completions API for tool calling');
        return false;
      })();

      if (shouldUseResponses) {
        log('calling responses.create for tool calling');
        const input = await convertOpenAIResponseInputs(messages as any, this.id);

        const res = await this.client.responses.create(
          {
            input,
            model,
            tool_choice: 'required',
            tools: tools!.map((tool) => this.convertChatCompletionToolToResponseTool(tool)),
            user: options?.user,
          },
          { headers: options?.headers, signal: options?.signal },
        );

        const functionCalls = res.output?.filter((item: any) => item.type === 'function_call');

        log('received %d function calls from Responses API', functionCalls?.length || 0);

        try {
          const result = functionCalls?.map((item: any) => ({
            arguments:
              typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments,
            name: item.name,
          }));
          log(
            'successfully parsed function calls: %O',
            result?.map((r) => r.name),
          );
          return result;
        } catch (error) {
          log('failed to parse tool call arguments: %O', error);
          console.error('parse tool call arguments error:', res);
          return undefined;
        }
      }

      log('calling chat.completions.create for tool calling');
      const msgs = messages;

      const res = await this.client.chat.completions.create(
        {
          messages: msgs,
          model,
          tool_choice: 'required',
          tools,
          user: options?.user,
        },
        { headers: options?.headers, signal: options?.signal },
      );

      const toolCalls = res.choices[0].message.tool_calls!;

      log('received %d tool calls from Chat Completions API', toolCalls?.length || 0);

      try {
        const result = (toolCalls as OpenAI.ChatCompletionMessageFunctionToolCall[]).map(
          (item) => ({
            arguments: JSON.parse(item.function.arguments),
            name: item.function.name,
          }),
        );
        log(
          'successfully parsed tool calls: %O',
          result.map((r) => r.name),
        );
        return result;
      } catch (error) {
        log('failed to parse tool call arguments: %O', error);
        console.error('parse tool call arguments error:', res);
        return undefined;
      }
    }
  };
};
