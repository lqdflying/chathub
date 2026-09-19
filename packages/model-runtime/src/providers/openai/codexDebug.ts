/**
 * CHATHUB_OPENAI_CODEX_DEBUG — prefixed JSON for ChatGPT / Codex OAuth and
 * chatgpt.com/backend-api/codex traffic. Value semantics match
 * CHATHUB_TOOLS_DEBUG (unset/0/false/off → off; 1/true/on/safe → on;
 * verbose/2 → same records). Never logs tokens, device codes, emails,
 * prompts, or response text.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status
 */

const OFF_VALUES = new Set(['', '0', 'false', 'off']);
const ON_VALUES = new Set(['1', 'true', 'on', 'safe', '2', 'verbose']);
const SAFE_STRING_KEY =
  /^(?:errorClass|kind|mediaType|operation|outcome|phase|provider|reason|status)$/;
const SAFE_STRING_VALUE = /^[A-Za-z][\w+./:-]{0,63}$/;

export const OPENAI_CODEX_DEBUG_NAMESPACE = 'chathub-openai-codex-debug';

export type OpenAICodexDebugEvent =
  | 'chat_request_settled'
  | 'chat_request_started'
  | 'chat_stream_settled'
  | 'device_login_settled'
  | 'device_poll_settled'
  | 'logout_settled'
  | 'models_fetch_settled'
  | 'refresh_settled'
  | 'resolve_overlay_settled'
  | 'resolve_session_settled'
  | 'token_exchange_settled';

export const isOpenAICodexDebugEnabled = (): boolean => {
  const value = (process.env.CHATHUB_OPENAI_CODEX_DEBUG ?? '').trim().toLowerCase();
  return ON_VALUES.has(value) && !OFF_VALUES.has(value);
};

export const classifyCodexMediaType = (value?: string | null): string => {
  const raw = (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!raw) return 'empty';
  if (raw === 'text/event-stream') return 'text/event-stream';
  if (raw === 'application/json') return 'application/json';
  if (raw === 'text/html') return 'text/html';
  if (raw === 'text/plain') return 'text/plain';
  return 'other';
};

export type CodexStreamSettledOutcome =
  | 'cancelled'
  | 'empty'
  | 'error'
  | 'failed'
  | 'incomplete'
  | 'ok'
  | 'parse_error'
  | 'unexpected_end';

/**
 * Map Responses lifecycle state to a safe `chat_stream_settled` outcome.
 * Event count is a metric only — a failed or truncated stream can still
 * parse one or more SSE frames.
 */
export const classifyCodexStreamSettled = ({
  cancelled,
  sseEventCount,
  succeeded,
  terminalReason,
}: {
  cancelled: boolean;
  sseEventCount: number;
  succeeded: boolean;
  terminalReason?: string;
}): { outcome: CodexStreamSettledOutcome; reason?: string } => {
  if (succeeded) return { outcome: 'ok' };
  if (cancelled || terminalReason === 'consumer_cancelled') return { outcome: 'cancelled' };
  if (sseEventCount === 0 && (!terminalReason || terminalReason === 'unexpected_end')) {
    return { outcome: 'empty' };
  }

  switch (terminalReason) {
    case 'response_failed': {
      return { outcome: 'failed', reason: 'response_failed' };
    }
    case 'content_filter':
    case 'max_output_tokens':
    case 'response_incomplete': {
      return { outcome: 'incomplete', reason: terminalReason };
    }
    case 'unexpected_end': {
      return { outcome: 'unexpected_end', reason: 'missing_terminal_event' };
    }
    case 'html_response':
    case 'invalid_json': {
      return { outcome: 'parse_error', reason: terminalReason };
    }
    case 'missing_status':
    case 'provider_error':
    case 'responses_stream_error':
    case 'stream_chunk_error':
    case 'tool_call_correlation_error': {
      return { outcome: 'error', reason: terminalReason };
    }
    default: {
      return { outcome: 'error', reason: 'stream_error' };
    }
  }
};

export const describeOpenAICodexErrorClass = (error: unknown): string => {
  const name = (error as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && /^[A-Za-z][\dA-Za-z]{0,63}$/.test(name) ? name : 'OtherError';
};

export const logOpenAICodexDebugSafe = (
  event: OpenAICodexDebugEvent,
  fields: Record<string, unknown> = {},
) => {
  if (!isOpenAICodexDebugEnabled()) return;

  const record: Record<string, unknown> = {
    debugLevel: 'safe',
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      record[key] = value;
      continue;
    }
    if (typeof value === 'string' && SAFE_STRING_KEY.test(key) && SAFE_STRING_VALUE.test(value)) {
      record[key] = value;
    }
  }

  try {
    // eslint-disable-next-line no-console
    console.log(`[${OPENAI_CODEX_DEBUG_NAMESPACE}:${event}]`, JSON.stringify(record));
  } catch {
    // Diagnostics must never interrupt login or chat.
  }
};
