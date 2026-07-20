import type { ToolCacheDebugMetadata } from '@lobechat/types';

import { buildEffectiveProviderURL, summarizeProviderDebugURL } from '../../utils/providerDebug';
import { sanitizeToolCacheDebugMetadata } from '../cacheDiagnostics';
import { normalizeCompatSeedJSON } from './openaicompatCache';

type OpenAICompatRoute = '/chat/completions' | '/responses';

type DebugSecretSummary =
  | {
      hash: string;
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
  let hash = 2_166_136_261;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableHash16 = (value: unknown) => {
  const text = typeof value === 'string' ? value : normalizeCompatSeedJSON(value);
  let firstLane = 2_166_136_261;
  let secondLane = 2_654_435_769;

  for (let index = 0; index < text.length; index += 1) {
    const characterCode = text.charCodeAt(index);
    firstLane = Math.imul(firstLane ^ characterCode, 16_777_619);
    secondLane = Math.imul(secondLane ^ (characterCode + index), 2_246_822_507);
  }

  return `${(firstLane >>> 0).toString(16).padStart(8, '0')}${(secondLane >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
};

const summarizeSecret = (value: unknown): DebugSecretSummary => {
  if (typeof value !== 'string' || value.length === 0) return { present: false };

  return {
    hash: stableHash(value),
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
  if (!Array.isArray(content))
    return content === undefined || content === null ? 'empty' : typeof content;

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
  if (!Array.isArray(tools)) return { count: 0, fingerprint: stableHash([]) };

  return {
    count: tools.length,
    fingerprint: stableHash(tools),
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
  baseURL,
  debugToolCache,
  headers,
  payload,
  route,
}: {
  baseURL?: string;
  debugToolCache?: ToolCacheDebugMetadata;
  headers?: Record<string, any>;
  payload: Record<string, any>;
  route: OpenAICompatRoute;
}): string => {
  const items = route === '/responses' ? payload.input : payload.messages;
  const sequence = sequenceSummary(items);
  const requestHash = stableHash16({ payload, route });

  console.log(
    '[openai-compatible-cache-debug:request]',
    JSON.stringify({
      cache: cacheSummary(payload, headers),
      effectiveURL: summarizeProviderDebugURL(buildEffectiveProviderURL(baseURL, route)),
      fingerprint: stableHash(payload),
      inputItemCount: sequence.count,
      model: payload.model,
      params: responseParamShape(payload),
      reasoningEffort: payload.reasoning?.effort ?? payload.reasoning_effort ?? null,
      requestHash,
      route,
      stream: payload.stream ?? null,
      toolCache: sanitizeToolCacheDebugMetadata(debugToolCache) ?? null,
      toolChoice: payload.tool_choice
        ? summarizeSecret(normalizeCompatSeedJSON(payload.tool_choice))
        : null,
      tools: toolSummary(payload.tools),
      turnShape: sequence,
    }),
  );

  return requestHash;
};

export const debugOpenAICompatCacheUsage = ({
  model,
  requestHash,
  route,
  toolCache,
  usage,
}: {
  model?: string;
  requestHash?: string;
  route: OpenAICompatRoute;
  toolCache?: ToolCacheDebugMetadata;
  usage: DebugUsage;
}) => {
  const responseHash = stableHash16({
    model,
    requestHash,
    responseId: usage.responseId ?? null,
    route,
  });

  console.log(
    '[openai-compatible-cache-debug:usage]',
    JSON.stringify({
      cacheMissTokens: usage.cacheMissTokens ?? null,
      cachedTokens: usage.cachedTokens ?? null,
      inputTokens: usage.inputTokens ?? null,
      model,
      outputTokens: usage.outputTokens ?? null,
      promptTokens: usage.promptTokens ?? null,
      requestHash: requestHash ?? null,
      requestId: summarizeSecret(usage.requestId),
      responseHash,
      responseId: summarizeSecret(usage.responseId),
      route,
      toolCache: sanitizeToolCacheDebugMetadata(toolCache) ?? null,
      totalTokens: usage.totalTokens ?? null,
    }),
  );
};
