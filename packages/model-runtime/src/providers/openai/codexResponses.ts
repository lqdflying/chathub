import { convertOpenAIResponseInputs } from '../../core/contextBuilders/openai';
import { OpenAIResponsesStream } from '../../core/streams';
import type { ChatMethodOptions, ChatStreamPayload, OpenAIChatMessage } from '../../types';
import { AgentRuntimeError } from '../../utils/createError';
import { StreamingResponse } from '../../utils/response';
import {
  classifyCodexMediaType,
  describeOpenAICodexErrorClass,
  logOpenAICodexDebugSafe,
} from './codexDebug';
import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_ORIGINATOR,
  OPENAI_CODEX_USER_AGENT,
} from './codexConstants';

export type CodexResponsesRequest = {
  include: string[];
  input: unknown[];
  instructions: string;
  model: string;
  reasoning?: { effort?: string };
  store: false;
  stream: true;
  text?: { verbosity?: 'high' | 'low' | 'medium' };
  tools?: Array<Record<string, unknown>>;
};

const messageText = (content: OpenAIChatMessage['content']): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        return typeof part.text === 'string' ? part.text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

export const buildCodexResponsesUrl = (baseURL = OPENAI_CODEX_BASE_URL) => {
  const normalized = baseURL.replace(/\/+$/, '');
  if (normalized.endsWith('/codex/responses')) return normalized;
  if (normalized.endsWith('/codex')) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
};

export const buildCodexResponsesHeaders = ({
  accessToken,
  accountId,
  requestId,
}: {
  accessToken: string;
  accountId: string;
  requestId?: string;
}): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    'User-Agent': OPENAI_CODEX_USER_AGENT,
    accept: 'text/event-stream',
    'chatgpt-account-id': accountId,
    'content-type': 'application/json',
    originator: OPENAI_CODEX_ORIGINATOR,
  };

  if (requestId) {
    headers.session_id = requestId;
    headers['x-client-request-id'] = requestId;
  }

  return headers;
};

export const buildCodexResponsesPayload = async (
  payload: ChatStreamPayload,
): Promise<CodexResponsesRequest> => {
  const messages = payload.messages ?? [];
  const instructionMessages = messages.filter(
    (message) => message.role === 'system' || message.role === 'developer',
  );
  const inputMessages = messages.filter(
    (message) => message.role !== 'system' && message.role !== 'developer',
  );
  const instructions =
    instructionMessages.map((message) => messageText(message.content)).filter(Boolean).join('\n\n') ||
    'You are a helpful assistant.';

  const input = await convertOpenAIResponseInputs(inputMessages as any, 'openai');
  const verbosity = payload.text?.verbosity || payload.verbosity;
  const effort = payload.reasoning?.effort || payload.reasoning_effort;
  const tools = payload.tools?.map((tool) => ({
    strict: false,
    type: tool.type,
    ...tool.function,
  }));

  return {
    include: ['reasoning.encrypted_content'],
    input,
    instructions,
    model: payload.model,
    store: false,
    stream: true,
    ...(verbosity ? { text: { verbosity } } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(tools?.length ? { tools } : {}),
  };
};

export async function* parseCodexResponsesSse(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      if (done) buffer += decoder.decode();

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = done ? '' : (parts.pop() ?? '');

      for (const part of parts) {
        const data = part
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        yield JSON.parse(data) as Record<string, unknown>;
      }

      if (done) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export const chatWithCodexResponses = async ({
  accessToken,
  accountId,
  payload,
  options,
  fetchFn = fetch,
}: {
  accessToken: string;
  accountId: string;
  fetchFn?: typeof fetch;
  options?: ChatMethodOptions;
  payload: ChatStreamPayload;
}): Promise<Response> => {
  const body = await buildCodexResponsesPayload(payload);
  const requestId = options?.trustedPromptCacheKey;
  const headers = buildCodexResponsesHeaders({ accessToken, accountId, requestId });
  const url = buildCodexResponsesUrl();
  const startedAt = Date.now();

  await options?.onRequestPrepared?.(body, { apiMode: 'responses' });
  logOpenAICodexDebugSafe('chat_request_started', {
    operation: 'chat',
    provider: 'openai',
  });

  let response: Response;
  try {
    response = await fetchFn(url, {
      body: JSON.stringify(body),
      headers,
      method: 'POST',
      signal: options?.signal,
    });
  } catch (error) {
    logOpenAICodexDebugSafe('chat_request_settled', {
      durationMs: Date.now() - startedAt,
      errorClass: describeOpenAICodexErrorClass(error),
      outcome: 'transport_error',
      provider: 'openai',
    });
    throw error;
  }

  const mediaType = classifyCodexMediaType(response.headers.get('content-type'));
  logOpenAICodexDebugSafe('chat_request_settled', {
    durationMs: Date.now() - startedAt,
    hasBody: !!response.body,
    httpStatus: response.status,
    mediaType,
    outcome: response.ok ? 'ok' : 'http_error',
    provider: 'openai',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw AgentRuntimeError.chat({
      error: {
        message: errorText || `Codex responses failed (HTTP ${response.status}).`,
        status: response.status,
      },
      errorType: 'ProviderBizError',
      provider: 'openai',
    });
  }

  const streamStartedAt = Date.now();
  async function* countedCodexSse() {
    let sseEventCount = 0;
    try {
      for await (const event of parseCodexResponsesSse(response)) {
        sseEventCount += 1;
        yield event;
      }
    } finally {
      logOpenAICodexDebugSafe('chat_stream_settled', {
        durationMs: Date.now() - streamStartedAt,
        outcome: sseEventCount > 0 ? 'ok' : 'empty',
        provider: 'openai',
        sseEventCount,
      });
    }
  }

  return StreamingResponse(
    OpenAIResponsesStream(
      countedCodexSse() as any,
      {
        callbacks: options?.callback,
        payload: {
          model: payload.model,
          provider: 'openai',
        },
      },
      { requireTerminalEvent: true },
    ),
    {
      headers: options?.headers,
      onCancel: options?.callback?.onCancel,
    },
  );
};
