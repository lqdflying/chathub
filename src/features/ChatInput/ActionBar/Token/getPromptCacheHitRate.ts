import type { MessageMetadata, ModelTokensUsage, UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';

export type PromptCacheHitStatus = 'hit' | 'miss' | 'reported';

export interface PromptCacheHitRate {
  cacheEligibleTokens?: number;
  cacheHitRate?: number;
  cacheHitTokens?: number;
  status: PromptCacheHitStatus;
}

export interface PromptCacheUsageSource {
  fromModel?: string;
  usage: ModelTokensUsage;
}

type PromptCacheMessage = Pick<
  UIChatMessage,
  'children' | 'content' | 'extra' | 'metadata' | 'role' | 'usage'
>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isAssistantLike = (role: UIChatMessage['role']) =>
  role === 'assistant' || role === 'group';

const isInFlightMessage = (message: PromptCacheMessage) =>
  message.content === LOADING_FLAT ||
  !!message.children?.some((child) => child.content === LOADING_FLAT);

export const hasPromptCacheTelemetry = (
  usage?: ModelTokensUsage | null,
): usage is ModelTokensUsage =>
  !!usage &&
  (isFiniteNumber(usage.inputCachedTokens) ||
    isFiniteNumber(usage.inputCacheMissTokens) ||
    isFiniteNumber(usage.inputWriteCacheTokens));

const hasTotalInput = (usage?: ModelTokensUsage | null): usage is ModelTokensUsage =>
  !!usage && isFiniteNumber(usage.totalInputTokens) && usage.totalInputTokens > 0;

const hasReportedTokens = (usage?: ModelTokensUsage | null): usage is ModelTokensUsage =>
  hasPromptCacheTelemetry(usage) ||
  hasTotalInput(usage) ||
  (!!usage && isFiniteNumber(usage.totalTokens));

type NestedUsageMetadata = MessageMetadata & { usage?: ModelTokensUsage };

/**
 * Durable generation used to persist `{ usage: ModelUsage }` on metadata.
 * Browser onFinish writes the same fields flat. Accept both.
 */
export const resolveStoredMessageUsage = (
  metadata?: MessageMetadata | null,
): MessageMetadata | undefined => {
  if (!metadata) return undefined;

  const nested = (metadata as NestedUsageMetadata).usage;
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && hasReportedTokens(nested)) {
    const { usage: _nested, ...rest } = metadata as NestedUsageMetadata;
    return { ...rest, ...nested };
  }

  return metadata;
};

const collectUsageSources = (message: PromptCacheMessage): ModelTokensUsage[] => {
  const sources: ModelTokensUsage[] = [];
  const children = message.children;
  if (children?.length) {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childUsage = children[index].usage;
      if (childUsage) sources.push(childUsage);
    }
  }
  if (message.usage) sources.push(message.usage);
  const resolvedMetadata = resolveStoredMessageUsage(message.metadata);
  if (resolvedMetadata) sources.push(resolvedMetadata);
  return sources;
};

/**
 * Hit rate is cached tokens divided by all provider-reported input.
 * Do not switch the denominator when a zero Anthropic write counter was stripped.
 * Totals-only usage (no cache counters) is 0 / totalInput with status `reported`.
 */
export const getPromptCacheHitRate = (
  usage?: ModelTokensUsage | null,
): PromptCacheHitRate | undefined => {
  if (!usage) return undefined;

  if (!hasPromptCacheTelemetry(usage)) {
    if (!hasTotalInput(usage)) return undefined;
    return {
      cacheEligibleTokens: usage.totalInputTokens,
      cacheHitRate: 0,
      cacheHitTokens: 0,
      status: 'reported',
    };
  }

  const hasWrite = isFiniteNumber(usage.inputWriteCacheTokens);
  const hasMiss = isFiniteNumber(usage.inputCacheMissTokens);
  const hasHit = isFiniteNumber(usage.inputCachedTokens);

  let cacheHitTokens: number | undefined;
  if (hasHit) {
    cacheHitTokens = usage.inputCachedTokens;
  } else if (hasWrite || hasMiss) {
    cacheHitTokens = 0;
  }

  let cacheEligibleTokens: number | undefined;
  if (isFiniteNumber(usage.totalInputTokens) && usage.totalInputTokens > 0) {
    cacheEligibleTokens = usage.totalInputTokens;
  } else if (hasMiss) {
    cacheEligibleTokens = (cacheHitTokens ?? 0) + usage.inputCacheMissTokens;
  } else if (hasWrite) {
    cacheEligibleTokens = (cacheHitTokens ?? 0) + usage.inputWriteCacheTokens;
  }

  const cacheHitRate =
    cacheHitTokens !== undefined &&
    cacheEligibleTokens !== undefined &&
    cacheEligibleTokens > 0
      ? cacheHitTokens / cacheEligibleTokens
      : undefined;

  let status: PromptCacheHitStatus = 'reported';
  if (cacheHitTokens !== undefined) {
    status = cacheHitTokens > 0 ? 'hit' : 'miss';
  }

  return {
    cacheEligibleTokens,
    cacheHitRate,
    cacheHitTokens,
    status,
  };
};

export const findLatestPromptCacheUsage = (
  messages: PromptCacheMessage[],
): PromptCacheUsageSource | undefined => {
  let totalsFallback: PromptCacheUsageSource | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantLike(message.role) || isInFlightMessage(message)) continue;

    const sources = collectUsageSources(message);
    const cacheUsage = sources.find(hasPromptCacheTelemetry);
    if (cacheUsage) {
      return {
        fromModel: message.extra?.fromModel,
        usage: cacheUsage,
      };
    }

    if (!totalsFallback) {
      const totalsUsage = sources.find(hasTotalInput);
      if (totalsUsage) {
        totalsFallback = {
          fromModel: message.extra?.fromModel,
          usage: totalsUsage,
        };
      }
    }
  }

  return totalsFallback;
};
