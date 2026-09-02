import { LOBE_CHAT_OBSERVATION_ID } from '@lobechat/const';
import {
  classifyChatStreamFetchError,
  FetchSSEOptions,
  getMessageError,
} from '@lobechat/fetch-sse';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { ChatMessageError } from '@lobechat/types';

import { getTraceId } from '@/utils/trace';

import {
  extractJsonChatCompletionResult,
  inspectJsonChatCompletion,
} from './extractJsonChatCompletion';
import type { JsonChatCompletionInspection } from './extractJsonChatCompletion';

const isEventStreamResponse = (response: Response) =>
  (response.headers.get('content-type') ?? '').includes('text/event-stream');

const toChatMessageError = (error: unknown, reason: string): ChatMessageError => ({
  body: {
    errorKind: classifyChatStreamFetchError(error),
    reason,
  },
  message: error instanceof Error ? error.message : String(error),
  type: AgentRuntimeErrorType.ConnectionCheckFailed,
});

export interface FetchJsonChatCompletionParams extends FetchSSEOptions {
  headers: Record<string, string>;
  onJsonResponse?: (inspection: JsonChatCompletionInspection) => void;
  payload: unknown;
  signal?: AbortSignal;
  /**
   * Some runtimes ignore `responseMode: 'json'` and still wrap as SSE
   * (Anthropic Messages). Reuse the already-opened Response so we do not POST twice.
   */
  sseFallback: (response: Response) => Promise<Response | void>;
  url: string;
}

/**
 * POST a chat completion and parse `application/json` with `Response.json()`.
 * Safari iOS reliably buffers complete JSON; it often throws `TypeError: Load
 * failed` on a short `text/event-stream` body without delivering bytes to JS.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Response/json
 */
export const fetchJsonChatCompletion = async ({
  fetcher,
  headers,
  onAbort,
  onErrorHandle,
  onFinish,
  onJsonResponse,
  onMessageHandle,
  payload,
  signal,
  sseFallback,
  url,
}: FetchJsonChatCompletionParams) => {
  const request = fetcher ?? fetch;

  try {
    const response = await request(url, {
      body: JSON.stringify(payload),
      headers: {
        ...headers,
        Accept: 'application/json',
      },
      method: 'POST',
      signal,
    });

    if (isEventStreamResponse(response)) {
      return sseFallback(response);
    }

    if (!response.ok) {
      onErrorHandle?.(await getMessageError(response));
      return response;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      onErrorHandle?.(toChatMessageError(error, 'json_chat_parse_failed'));
      return response;
    }

    const inspection = inspectJsonChatCompletion(data);
    onJsonResponse?.({
      ...inspection,
      summary: {
        ...inspection.summary,
        mediaType: response.headers.get('content-type') ?? undefined,
      },
    });

    const extracted = extractJsonChatCompletionResult(data);
    if (extracted.reasoning) {
      onMessageHandle?.({ text: extracted.reasoning, type: 'reasoning' });
    }
    if (extracted.text) {
      onMessageHandle?.({ text: extracted.text, type: 'text' });
    }

    await onFinish?.(extracted.text, {
      observationId: response.headers.get(LOBE_CHAT_OBSERVATION_ID),
      reasoning: extracted.reasoning ? { content: extracted.reasoning } : undefined,
      traceId: getTraceId(response),
      type: 'done',
    });

    return response;
  } catch (error) {
    if (signal?.aborted || classifyChatStreamFetchError(error) === 'abort') {
      await onAbort?.('');
      return;
    }

    onErrorHandle?.(toChatMessageError(error, 'json_chat_fetch_failed'));
  }
};
