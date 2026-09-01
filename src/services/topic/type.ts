/* eslint-disable typescript-sort-keys/interface */
import type { TopicMemoryRollupRow } from '@/database/models/topic';

import type { ConversationWriteOptions } from '@/services/conversationWrite';
import { BatchTaskResult } from '@/types/service';
import { ChatTopic, ChatTopicMetadata, TopicRankItem } from '@/types/topic';

export interface CreateTopicParams {
  /** Stable client id for idempotent create retries (maps to topics.clientId). */
  clientId?: string;
  favorite?: boolean;
  groupId?: string | null;
  /** Optional server topic id when the client pre-allocates one. */
  id?: string;
  messages?: string[];
  sessionId?: string | null;
  title: string;
}

export interface QueryTopicParams {
  current?: number;
  containerId?: string | null; // sessionId or groupId
  pageSize?: number;
}

export interface ITopicService {
  createTopic(params: CreateTopicParams, options?: ConversationWriteOptions): Promise<string>;
  batchCreateTopics(
    importTopics: ChatTopic[],
    options?: ConversationWriteOptions,
  ): Promise<BatchTaskResult>;
  cloneTopic(id: string, newTitle?: string, options?: ConversationWriteOptions): Promise<string>;

  getTopics(params: QueryTopicParams): Promise<ChatTopic[]>;
  listTopicsForAgentMemoryRollup(agentId: string, limit?: number): Promise<TopicMemoryRollupRow[]>;
  getAllTopics(): Promise<ChatTopic[]>;
  countTopics(params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number>;
  rankTopics(limit?: number): Promise<TopicRankItem[]>;
  searchTopics(keyword: string, sessionId?: string, groupId?: string): Promise<ChatTopic[]>;

  mergeReportedInputTokenFloorWatermark(
    id: string,
  ): Promise<
    | {
        historySummary?: string | null;
        historySummaryLastMessageId?: string;
        reportedInputTokenFloorAfterMessageId?: string;
        updated: boolean;
      }
    | undefined
  >;
  persistMemoryCompaction(
    id: string,
    params: {
      candidateMessageIds: string[];
      compactedThroughMessageId: string;
      expectedCursorId?: string;
      expectedFingerprint: string;
      expectedHistorySummary: string;
      historySummary: string;
      metadata: ChatTopicMetadata;
    },
  ): Promise<{ accepted: boolean; metadata?: ChatTopicMetadata }>;
  updateTopic(
    id: string,
    data: Partial<ChatTopic>,
    options?: { touchActivity?: boolean },
  ): Promise<any>;

  removeTopic(id: string): Promise<any>;
  removeTopics(sessionId: string): Promise<any>;
  batchRemoveTopics(topics: string[]): Promise<any>;
  removeAllTopic(): Promise<any>;
}
