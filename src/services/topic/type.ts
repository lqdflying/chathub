/* eslint-disable typescript-sort-keys/interface */
import type { TopicMemoryRollupRow } from '@/database/models/topic';

import type { ConversationWriteOptions } from '@/services/conversationWrite';
import { BatchTaskResult } from '@/types/service';
import { ChatTopic, TopicRankItem } from '@/types/topic';

export interface CreateTopicParams {
  favorite?: boolean;
  groupId?: string | null;
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
