import { normalizeCompatSeedJSON } from './openaicompatCache';

type OpenAICompatRoute = '/chat/completions' | '/responses';

type DebugSecretSummary =
  | {
      hash: string;
      prefix: string;
      present: true;
    }
  | {
      present: false;
    };

type DebugUsage = {
  cacheMissTokens?: number | null;
  cachedTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  promptTokens?: number | null;
  requestId?: string | null;
  responseId?: string | null;
  totalTokens?: number | null;
};

const stableHash = (value: unknown) => {
  const text = typeof value === 'string' ? value : normalizeCompatSeedJSON(value);
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const summarizeSecret = (value: unknown): DebugSecretSummary => {
  if (typeof value !== 'string' || value.length === 0) return { present: false };

  return {
    hash: stableHash(value),
    prefix: value.slice(0, 12),
    present: true,
  };
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

const itemKind = (item: any) => {
  if (!item || typeof item !== 'object') return typeof item;

  const role = typeof item.role === 'string' ? item.role : '';
  const type = typeof item.type === 'string' ? item.type : '';
  if (role && type) return `${role}:${type}`;
  return role || type || 'object';
};

const contentShape = (content: unknown) => {
  if (typeof content === 'string') return 'text';
  if (!Array.isArray(content)) return content === undefined || content === null ? 'empty' : typeof content;

  return content
    .map((part) => {
      const value = asRecord(part);
      return typeof value.type === 'string' ? value.type : typeof part;
    })
    .join(',');
};

const sequenceSummary = (items: unknown) => {
  if (!Array.isArray(items)) return { count: 0, sequence: [] as string[] };

  return {
    count: items.length,
    sequence: items.map((item: any) => `${itemKind(item)}:${contentShape(item?.content)}`),
  };
};

const toolSummary = (tools: unknown) => {
  if (!Array.isArray(tools)) return { count: 0, fingerprint: stableHash([]), names: [] as string[] };

  const names = tools.map((tool: any) => tool?.function?.name || tool?.name || tool?.type || 'unknown');

  return {
    count: tools.length,
    fingerprint: stableHash(tools),
    names,
  };
};

const responseParamShape = (payload: Record<string, any>) => ({
  hasMaxOutputTokens: payload.max_output_tokens !== undefined,
  hasMaxTokens: payload.max_tokens !== undefined,
  hasTextVerbosity: asRecord(payload.text).verbosity !== undefined,
  hasTopLevelVerbosity: payload.verbosity !== undefined,
  truncation: payload.truncation ?? null,
});

const cacheSummary = (payload: Record<string, any>, headers?: Record<string, any>) => ({
  promptCacheKey: summarizeSecret(payload.prompt_cache_key),
  sessionId: summarizeSecret(headers?.Session_id ?? headers?.session_id),
  store: payload.store ?? null,
});

export const debugOpenAICompatCacheRequest = ({
  headers,
  payload,
  route,
}: {
  headers?: Record<string, any>;
  payload: Record<string, any>;
  route: OpenAICompatRoute;
}) => {
  const items = route === '/responses' ? payload.input : payload.messages;
  const sequence = sequenceSummary(items);

  console.log(
    '[openai-compatible-cache-debug:request]',
    JSON.stringify({
      cache: cacheSummary(payload, headers),
      fingerprint: stableHash(payload),
      model: payload.model,
      params: responseParamShape(payload),
      reasoningEffort: payload.reasoning?.effort ?? payload.reasoning_effort ?? null,
      route,
      stream: payload.stream ?? null,
      toolChoice: payload.tool_choice ?? null,
      tools: toolSummary(payload.tools),
      turnShape: sequence,
    }),
  );
};

export const debugOpenAICompatCacheUsage = ({
  model,
  route,
  usage,
}: {
  model?: string;
  route: OpenAICompatRoute;
  usage: DebugUsage;
}) => {
  console.log(
    '[openai-compatible-cache-debug:usage]',
    JSON.stringify({
      cachedTokens: usage.cachedTokens ?? null,
      cacheMissTokens: usage.cacheMissTokens ?? null,
      inputTokens: usage.inputTokens ?? null,
      model,
      outputTokens: usage.outputTokens ?? null,
      promptTokens: usage.promptTokens ?? null,
      requestId: usage.requestId ?? null,
      responseId: usage.responseId ?? null,
      route,
      totalTokens: usage.totalTokens ?? null,
    }),
  );
};
