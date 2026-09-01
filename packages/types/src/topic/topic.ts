import { z } from 'zod';

import { BaseDataModel } from '@/types/meta';

// 类型定义
export type TimeGroupId =
  'today' | 'yesterday' | 'week' | 'month' | `${number}-${string}` | `${number}`;

/* eslint-disable typescript-sort-keys/string-enum */
export enum TopicDisplayMode {
  ByTime = 'byTime',
  Flat = 'flat',
  // AscMessages = 'ascMessages',
  // DescMessages = 'descMessages',
}
/* eslint-enable */

export interface GroupedTopic {
  children: ChatTopic[];
  id: string;
  title?: string;
}

export type MemoryCompactionTrigger = 'manual' | 'message_count' | 'scheduled' | 'token_threshold';

export type MemoryCompactionStatus =
  | 'compacted'
  | 'enqueued'
  | 'failed'
  | 'ineligible'
  | 'not_needed'
  | 'target_unreachable';

export interface MemoryCompactionResult {
  estimatedTokensAfter?: number;
  estimatedTokensBefore?: number;
  highWatermark?: number;
  lowWatermark?: number;
  messageCountIncluded?: number;
  reason?: string;
  status: MemoryCompactionStatus;
}

export interface MemoryCompactionDebugEntry {
  at: number;
  compactedThroughMessageId?: string;
  estimatedTokensAfter?: number;
  estimatedTokensBefore?: number;
  highWatermark?: number;
  lowWatermark?: number;
  messageCountIncluded?: number;
  model?: string;
  provider?: string;
  reason?: string;
  status?: MemoryCompactionStatus;
  trigger: MemoryCompactionTrigger;
}

export interface SummaryHistoryOptions {
  estimatedTokensBefore?: number;
  trigger?: MemoryCompactionTrigger;
}

export interface TopicMemoryArchiveEntry {
  at: number;
  summaryExcerpt: string;
  trigger?: MemoryCompactionTrigger;
}

export interface ChatTopicMetadata {
  historySummaryLastMessageId?: string;
  memoryArchives?: TopicMemoryArchiveEntry[];
  memoryDebugLog?: MemoryCompactionDebugEntry[];
  model?: string;
  provider?: string;
  /**
   * Newest assistant/group id in the protected post-cursor window at compaction
   * time, including an in-flight placeholder. Next-request token floors only
   * use assistants after this id. A missing row fail-closes (no floor) instead
   * of treating older usage as fresh. Compacted topics without this field treat
   * every current post-cursor assistant as already-seen until a later compact
   * stamps the boundary.
   */
  reportedInputTokenFloorAfterMessageId?: string;
}

const memoryCompactionTriggerSchema = z.enum([
  'manual',
  'message_count',
  'scheduled',
  'token_threshold',
]);
const memoryCompactionStatusSchema = z.enum([
  'compacted',
  'enqueued',
  'failed',
  'ineligible',
  'not_needed',
  'target_unreachable',
]);

export const ChatTopicMetadataSchema = z.object({
  historySummaryLastMessageId: z.string().optional(),
  memoryArchives: z
    .array(
      z.object({
        at: z.number(),
        summaryExcerpt: z.string(),
        trigger: memoryCompactionTriggerSchema.optional(),
      }),
    )
    .optional(),
  memoryDebugLog: z
    .array(
      z.object({
        at: z.number(),
        compactedThroughMessageId: z.string().optional(),
        estimatedTokensAfter: z.number().optional(),
        estimatedTokensBefore: z.number().optional(),
        highWatermark: z.number().optional(),
        lowWatermark: z.number().optional(),
        messageCountIncluded: z.number().optional(),
        model: z.string().optional(),
        provider: z.string().optional(),
        reason: z.string().optional(),
        status: memoryCompactionStatusSchema.optional(),
        trigger: memoryCompactionTriggerSchema,
      }),
    )
    .optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  reportedInputTokenFloorAfterMessageId: z.string().min(1).optional(),
}) satisfies z.ZodType<ChatTopicMetadata>;

export interface ChatTopicSummary {
  content: string;
  model: string;
  provider: string;
}

export interface ChatTopic extends Omit<BaseDataModel, 'meta'> {
  favorite?: boolean;
  historySummary?: string;
  lastActivityAt?: number;
  metadata?: ChatTopicMetadata;
  sessionId?: string;
  title: string;
}

export type ChatTopicMap = Record<string, ChatTopic>;

export interface TopicRankItem {
  count: number;
  id: string;
  sessionId: string | null;
  title: string | null;
}
