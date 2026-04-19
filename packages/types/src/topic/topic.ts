import { BaseDataModel } from '@/types/meta';

// 类型定义
export type TimeGroupId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | `${number}-${string}`
  | `${number}`;

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

export type MemoryCompactionTrigger =
  | 'manual'
  | 'message_count'
  | 'scheduled'
  | 'token_threshold';

export interface MemoryCompactionDebugEntry {
  at: number;
  estimatedTokensAfter?: number;
  estimatedTokensBefore?: number;
  messageCountIncluded?: number;
  model?: string;
  provider?: string;
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
  memoryArchives?: TopicMemoryArchiveEntry[];
  memoryDebugLog?: MemoryCompactionDebugEntry[];
  model?: string;
  provider?: string;
}

export interface ChatTopicSummary {
  content: string;
  model: string;
  provider: string;
}

export interface ChatTopic extends Omit<BaseDataModel, 'meta'> {
  favorite?: boolean;
  historySummary?: string;
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
