import { AgentRuntimeErrorType } from '@lobechat/model-runtime';

/**
 * Shared context-overflow classifier (server-safe, no client imports).
 *
 * True when an upstream failure means "the request did not fit the model
 * window" — the precondition for the compact-and-retry self-healing path in
 * both the browser lane (`generateAIChat`/`generateAIChatV2`) and the durable
 * worker lane (`conversationGeneration/execute`).
 *
 * Matches:
 * - structured `type: AgentRuntimeErrorType.ExceededContextWindow` (includes
 *   the empty-completion-at-ceiling error shape from
 *   `src/helpers/emptyCompletionAtContextCeiling.ts`)
 * - MiniMax `2013` (`invalid params, context window exceeds limit`) surfaced
 *   as `status_code` / `code` / `base_resp.status_code` in the error body
 * - provider overflow signatures in the message/body text (OpenAI
 *   `context_length_exceeded` / `maximum context length`, Anthropic
 *   `prompt is too long` / `request_too_large`, Gemini `token count exceeds`,
 *   MiniMax `context window exceeds limit`, `string_above_max_length`).
 */

const OVERFLOW_MESSAGE_PATTERNS = [
  'context_length_exceeded',
  'maximum context length',
  'prompt is too long',
  'string_above_max_length',
  'context window exceeds limit',
  'request_too_large',
  'token count exceeds',
  // normalized AgentRuntimeErrorType.ExceededContextWindow embedded in text
  'exceededcontextwindow',
];

/** MiniMax context-overflow error code (`bad_request_error` / 2013). */
const MINIMAX_CONTEXT_OVERFLOW_CODE = 2013;

/** Cap scanned text so a huge upstream body cannot stall the error path. */
const MAX_SCANNED_BODY_CHARS = 4000;

const readBodyCode = (body: Record<string, unknown>): unknown => {
  const baseResp = body.base_resp;
  return (
    body.status_code ??
    body.code ??
    (baseResp && typeof baseResp === 'object'
      ? (baseResp as Record<string, unknown>).status_code
      : undefined)
  );
};

const collectErrorText = (error: unknown): string => {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.type === 'string') parts.push(record.type);
    if (typeof record.message === 'string' && !(error instanceof Error)) parts.push(record.message);
    const upstream = record.upstream;
    if (upstream && typeof upstream === 'object') {
      const upstreamRecord = upstream as Record<string, unknown>;
      if (typeof upstreamRecord.type === 'string') parts.push(upstreamRecord.type);
      if (typeof upstreamRecord.message === 'string') parts.push(upstreamRecord.message);
    }
    if (record.body !== undefined) {
      const bodyText =
        typeof record.body === 'string'
          ? record.body
          : (() => {
              try {
                return JSON.stringify(record.body);
              } catch {
                return '';
              }
            })();
      if (bodyText) parts.push(bodyText.slice(0, MAX_SCANNED_BODY_CHARS));
    }
  } else if (typeof error === 'string') {
    parts.push(error);
  }
  return parts.join('\n');
};

const isContextOverflowMessage = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return OVERFLOW_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const isContextOverflowError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' && isContextOverflowMessage(error);
  }
  const record = error as Record<string, unknown>;
  if (record.type === AgentRuntimeErrorType.ExceededContextWindow) return true;
  if (record.body && typeof record.body === 'object') {
    const code = readBodyCode(record.body as Record<string, unknown>);
    if (code === MINIMAX_CONTEXT_OVERFLOW_CODE || code === String(MINIMAX_CONTEXT_OVERFLOW_CODE)) {
      return true;
    }
  }
  return isContextOverflowMessage(collectErrorText(error));
};

/** Default History Compress summarizer deadline (both browser and worker lanes). */
export const DEFAULT_COMPACTION_SUMMARIZER_TIMEOUT_MS = 120_000;

/**
 * Summarizer timeout, env-overridable. Server lane reads
 * `CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS`; the browser bundle can only see
 * build-time `NEXT_PUBLIC_CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS`.
 */
export const resolveCompactionSummarizerTimeoutMs = (): number => {
  const raw =
    (typeof process !== 'undefined' ? process.env?.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS : undefined) ??
    (typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS
      : undefined);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_COMPACTION_SUMMARIZER_TIMEOUT_MS;
};

/**
 * Combine an optional parent abort signal (user Stop / worker fence) with the
 * summarizer deadline. `isSummarizerTimeout()` distinguishes the deadline from
 * a parent abort so callers can fail once instead of retrying.
 */
export const createCompactionSummarizerTimeoutSignal = (parent?: AbortSignal) => {
  const timeout = AbortSignal.timeout(resolveCompactionSummarizerTimeoutMs());
  return {
    isSummarizerTimeout: () => timeout.aborted && !parent?.aborted,
    signal: parent ? AbortSignal.any([parent, timeout]) : timeout,
  };
};
