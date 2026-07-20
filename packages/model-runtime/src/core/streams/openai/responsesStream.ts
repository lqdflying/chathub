import { ChatCitationItem, ChatMessageError } from '@lobechat/types';
import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import { AgentRuntimeErrorType } from '../../../types/error';
import { normalizeOpenAICompatCacheUsage } from '../../openaiCompatibleFactory/openaicompatCache';
import { debugOpenAICompatCacheUsage } from '../../openaiCompatibleFactory/openaicompatDebug';
import { convertOpenAIResponseUsage, normalizeOpenAIStreamUsage } from '../../usageConverters';
import {
  ChatPayloadForTransformStream,
  FIRST_CHUNK_ERROR_KEY,
  StreamContext,
  StreamProtocolChunk,
  StreamProtocolToolCallChunk,
  StreamToolCallChunkData,
  convertIterableToStream,
  createCallbacksTransformer,
  createFirstErrorHandleTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
} from '../protocol';
import { OpenAIStreamOptions } from './openai';

type ResponsesStreamState = {
  succeeded: boolean;
};

type ResponsesIteratorError = {
  [key: string]: unknown;
  [FIRST_CHUNK_ERROR_KEY]: true;
  errorType?: (typeof AgentRuntimeErrorType)[keyof typeof AgentRuntimeErrorType];
  message?: unknown;
  name?: unknown;
  provider?: unknown;
  stack?: unknown;
};

const createResponsesErrorChunk = (
  streamContext: StreamContext,
  message: string,
  name: string,
): StreamProtocolChunk => {
  const errorData = {
    body: { message, name },
    message,
    type: AgentRuntimeErrorType.ProviderBizError,
  } satisfies ChatMessageError;

  return { data: errorData, id: streamContext.id, type: 'error' };
};

const isJSONSyntaxError = (error: ResponsesIteratorError) =>
  error.name === 'SyntaxError' &&
  typeof error.message === 'string' &&
  /json|unexpected (?:end|token)|expected property name/i.test(error.message);

const isHTMLResponseSyntaxError = (error: ResponsesIteratorError) =>
  isJSONSyntaxError(error) &&
  typeof error.message === 'string' &&
  error.message.includes('<') &&
  /<!doctype|<html|unexpected token ["']?</i.test(error.message);

const createResponsesIteratorError = (
  error: ResponsesIteratorError,
  streamContext: StreamContext,
): StreamProtocolChunk => {
  const errorId = streamContext.id || 'first_chunk_error';

  if (isHTMLResponseSyntaxError(error)) {
    return createResponsesErrorChunk(
      { ...streamContext, id: errorId },
      'The provider returned HTML instead of a valid Responses API stream. Verify that the configured endpoint supports /v1/responses and check the provider or reverse proxy logs.',
      'html_response',
    );
  }

  if (isJSONSyntaxError(error)) {
    return createResponsesErrorChunk(
      { ...streamContext, id: errorId },
      'The provider returned a malformed Responses API stream. Verify that it emits SSE events with valid JSON data.',
      'invalid_json',
    );
  }

  const errorBody = { ...error };
  delete errorBody[FIRST_CHUNK_ERROR_KEY];
  delete errorBody.name;
  delete errorBody.stack;
  const errorMessage =
    'message' in errorBody && typeof errorBody.message === 'string'
      ? errorBody.message
      : JSON.stringify(errorBody);
  const errorData = {
    body: errorBody,
    message: errorMessage,
    type:
      'errorType' in errorBody
        ? (errorBody.errorType as typeof AgentRuntimeErrorType.ProviderBizError)
        : AgentRuntimeErrorType.ProviderBizError,
  } satisfies ChatMessageError;

  return { data: errorData, id: errorId, type: 'error' };
};

const getResponsesToolState = (
  chunk: { item_id?: string; output_index?: number },
  streamContext: StreamContext,
) => {
  if (chunk.item_id) {
    const toolState = streamContext.toolsByItemId?.get(chunk.item_id);
    if (toolState) return toolState;
  }

  if (typeof chunk.output_index === 'number') {
    const toolState = streamContext.toolsByOutputIndex?.get(chunk.output_index);
    if (toolState) return toolState;
  }

  return streamContext.tool;
};

const transformOpenAIStream = (
  chunk:
    | OpenAI.Responses.ResponseStreamEvent
    | {
        annotation: {
          end_index: number;
          start_index: number;
          title: string;
          type: 'url_citation';
          url: string;
        };
        item_id: string;
        type: 'response.output_text.annotation.added';
      },
  streamContext: StreamContext,
  payload?: ChatPayloadForTransformStream,
  responsesStreamState?: ResponsesStreamState,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  if (FIRST_CHUNK_ERROR_KEY in chunk) {
    return createResponsesIteratorError(chunk as unknown as ResponsesIteratorError, streamContext);
  }

  try {
    switch (chunk.type) {
      case 'response.created': {
        streamContext.id = chunk.response.id;
        streamContext.returnedCitationArray = [];

        return { data: chunk.response.status, id: streamContext.id, type: 'data' };
      }

      case 'response.output_item.added': {
        switch (chunk.item.type) {
          case 'function_call': {
            streamContext.toolIndex =
              typeof streamContext.toolIndex === 'undefined' ? 0 : streamContext.toolIndex + 1;
            const toolMeta = {
              emittedArguments: '',
              id: chunk.item.call_id,
              index: streamContext.toolIndex,
              name: chunk.item.name,
            };
            streamContext.tool = toolMeta;
            if (!streamContext.toolsByItemId) streamContext.toolsByItemId = new Map();
            if (!streamContext.toolsByOutputIndex) streamContext.toolsByOutputIndex = new Map();
            if (chunk.item.id) streamContext.toolsByItemId.set(chunk.item.id, toolMeta);
            streamContext.toolsByItemId.set(chunk.item.call_id, toolMeta);
            streamContext.toolsByOutputIndex.set(chunk.output_index, toolMeta);

            return {
              data: [
                {
                  function: { arguments: '', name: chunk.item.name },
                  id: chunk.item.call_id,
                  index: streamContext.toolIndex!,
                  type: 'function',
                } satisfies StreamToolCallChunkData,
              ],
              id: streamContext.id,
              type: 'tool_calls',
            } satisfies StreamProtocolToolCallChunk;
          }
        }

        return { data: chunk.item, id: streamContext.id, type: 'data' };
      }

      case 'response.function_call_arguments.delta': {
        const toolMeta = getResponsesToolState(chunk, streamContext);
        if (toolMeta) toolMeta.emittedArguments = (toolMeta.emittedArguments || '') + chunk.delta;

        return {
          data: [
            {
              function: { arguments: chunk.delta, name: toolMeta?.name },
              id: toolMeta?.id,
              index: toolMeta?.index ?? streamContext.toolIndex!,
              type: 'function',
            } satisfies StreamToolCallChunkData,
          ],
          id: streamContext.id,
          type: 'tool_calls',
        } satisfies StreamProtocolToolCallChunk;
      }

      case 'response.function_call_arguments.done': {
        const toolMeta = getResponsesToolState(chunk, streamContext);
        if (!toolMeta) {
          return createResponsesErrorChunk(
            streamContext,
            `Unable to correlate completed arguments for tool ${chunk.name}`,
            'tool_call_correlation_error',
          );
        }

        if (toolMeta.emittedArguments) {
          return [];
        }

        toolMeta.emittedArguments = chunk.arguments;
        return {
          data: [
            {
              function: { arguments: chunk.arguments, name: toolMeta.name },
              id: toolMeta.id,
              index: toolMeta.index,
              type: 'function',
            } satisfies StreamToolCallChunkData,
          ],
          id: streamContext.id,
          type: 'tool_calls',
        } satisfies StreamProtocolToolCallChunk;
      }

      case 'response.output_text.delta': {
        return { data: chunk.delta, id: chunk.item_id, type: 'text' };
      }

      case 'response.refusal.delta': {
        return { data: chunk.delta, id: chunk.item_id, type: 'text' };
      }

      case 'response.reasoning_summary_part.added': {
        if (!streamContext.startReasoning) {
          streamContext.startReasoning = true;
          return { data: '', id: chunk.item_id, type: 'reasoning' };
        } else {
          return { data: '\n', id: chunk.item_id, type: 'reasoning' };
        }
      }

      case 'response.reasoning_summary_text.delta': {
        return { data: chunk.delta, id: chunk.item_id, type: 'reasoning' };
      }

      case 'response.reasoning_text.delta': {
        return { data: chunk.delta, id: chunk.item_id, type: 'reasoning' };
      }

      case 'response.output_text.annotation.added': {
        // In openai SDK v6+, the annotation field is typed as `unknown`.
        // Cast to the URL-citation shape we actually consume here.
        const citations = chunk.annotation as { title?: string; url?: string };

        if (streamContext.returnedCitationArray) {
          streamContext.returnedCitationArray.push({
            title: citations.title,
            url: citations.url,
          } as ChatCitationItem);
        }

        return { data: null, id: chunk.item_id, type: 'text' };
      }

      case 'response.output_item.done': {
        if (streamContext.returnedCitationArray?.length) {
          return {
            data: { citations: streamContext.returnedCitationArray },
            id: chunk.item.id,
            type: 'grounding',
          };
        }

        return { data: null, id: chunk.item.id, type: 'text' };
      }

      case 'response.failed': {
        const errObj = chunk.response?.error;
        const message =
          errObj?.message || (errObj?.code ? `Response failed: ${errObj.code}` : 'Response failed');
        return createResponsesErrorChunk(streamContext, message, errObj?.code || 'response_failed');
      }

      case 'response.incomplete': {
        const reason = chunk.response?.incomplete_details?.reason;
        const message = reason ? `Response incomplete: ${reason}` : 'Response incomplete';
        return createResponsesErrorChunk(streamContext, message, reason || 'response_incomplete');
      }

      case 'response.completed': {
        const status = chunk.response?.status;
        if (status !== 'completed') {
          const reason =
            chunk.response?.incomplete_details?.reason ||
            chunk.response?.error?.code ||
            status ||
            'missing_status';
          const message =
            chunk.response?.error?.message ||
            (reason ? `Response ${status}: ${reason}` : `Response ${status}`);
          return createResponsesErrorChunk(streamContext, message, String(reason));
        }

        if (responsesStreamState) responsesStreamState.succeeded = true;

        if (chunk.response.usage) {
          const response = normalizeOpenAICompatCacheUsage(chunk.response).json;
          if (payload?.debugOpenAICompatCache) {
            const usage = response.usage!;
            const cachedTokens = usage.input_tokens_details?.cached_tokens ?? null;

            debugOpenAICompatCacheUsage({
              model: payload.model,
              requestHash: payload.openAICompatRequestHash,
              route: '/responses',
              toolCache: payload.debugToolCache,
              usage: {
                cacheMissTokens:
                  cachedTokens === null || usage.input_tokens === undefined
                    ? null
                    : usage.input_tokens - cachedTokens,
                cachedTokens,
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                responseId: response.id,
                totalTokens: usage.total_tokens,
              },
            });
          }

          const convertedUsage = convertOpenAIResponseUsage(response.usage!, payload);
          streamContext.usage = convertedUsage;
          return {
            data: normalizeOpenAIStreamUsage(convertedUsage),
            id: response.id,
            type: 'usage',
          };
        }

        return { data: 'completed', id: chunk.response.id || streamContext.id, type: 'stop' };
      }

      case 'error': {
        return createResponsesErrorChunk(
          streamContext,
          chunk.message || 'Responses stream error',
          chunk.code || 'responses_stream_error',
        );
      }

      default: {
        return { data: chunk, id: streamContext.id, type: 'data' };
      }
    }
  } catch (e) {
    const errorName = 'StreamChunkError';
    console.error('[StreamChunkError]', e);
    console.error('[StreamChunkError] raw chunk:', chunk);

    const err = e as Error;

    /* eslint-disable sort-keys-fix/sort-keys-fix */
    const errorData = {
      body: {
        message:
          'chat response streaming chunk parse error, please contact your API Provider to fix it.',
        context: { error: { message: err.message, name: err.name }, chunk },
      },
      type: errorName,
    } as ChatMessageError;
    /* eslint-enable */

    return { data: errorData, id: streamContext.id, type: 'error' };
  }
};

export const OpenAIResponsesStream = (
  stream: Stream<OpenAI.Responses.ResponseStreamEvent> | ReadableStream,
  {
    callbacks,
    bizErrorTypeTransformer,
    inputStartAt,
    enableStreaming = true,
    payload,
  }: OpenAIStreamOptions = {},
  lifecycleOptions: { requireTerminalEvent?: boolean } = {},
) => {
  const streamStack: StreamContext = { id: '' };
  const responsesStreamState: ResponsesStreamState = { succeeded: false };

  const readableStream =
    stream instanceof ReadableStream ? stream : convertIterableToStream(stream);

  // use closure to pass payload to transformOpenAIStream
  const transformWithPayload: typeof transformOpenAIStream = (chunk, streamContext) =>
    transformOpenAIStream(chunk, streamContext, payload, responsesStreamState);

  return (
    readableStream
      // 1. handle the first error if exist
      // provider like huggingface or minimax will return error in the stream,
      // so in the first Transformer, we need to handle the error
      .pipeThrough(createFirstErrorHandleTransformer(bizErrorTypeTransformer, payload?.provider))
      .pipeThrough(
        createTokenSpeedCalculator(transformWithPayload, {
          enableStreaming: enableStreaming,
          inputStartAt,
          streamStack,
        }),
      )
      .pipeThrough(
        createSSEProtocolTransformer((chunk) => chunk, streamStack, {
          requireTerminalEvent: lifecycleOptions.requireTerminalEvent,
        }),
      )
      .pipeThrough(
        createCallbacksTransformer(callbacks, {
          resolveUsage: (serializedUsage) => streamStack.usage ?? serializedUsage,
          shouldCallCompletion: () => responsesStreamState.succeeded,
        }),
      )
  );
};
