import type { ConversationGenerationKind } from '@lobechat/types';

import { ChatTopic } from '@/types/topic';

import type { TitleSummaryOperation } from '../../types';

export interface ServerGenerationOperation {
  assistantMessageId?: string;
  clearGeneration: number;
  generation: number;
  groupId?: string;
  kind: ConversationGenerationKind;
  lane: string;
  laneGeneration?: number;
  operationId: string;
  revision?: number;
  sessionId: string;
  threadId?: string;
  topicId?: string;
  userScope: string;
}

export interface ChatTopicState {
  // TODO: need to add the null to the type
  activeTopicId?: string;
  creatingTopic: boolean;
  creatingTopicId?: string;
  inSearchingMode?: boolean;
  isSearchingTopic: boolean;
  searchTopics: ChatTopic[];
  serverGenerationOperations: Record<string, Record<string, ServerGenerationOperation>>;
  topicLoadingIds: string[];
  topicMaps: Record<string, ChatTopic[]>;
  topicRenamingId?: string;
  topicSearchKeywords: string;
  topicTitleSummaryOperations: Record<string, TitleSummaryOperation>;
  /**
   * whether topics have fetched
   */
  topicsInit: boolean;
}

export const initialTopicState: ChatTopicState = {
  activeTopicId: null as any,
  creatingTopic: false,
  isSearchingTopic: false,
  searchTopics: [],
  serverGenerationOperations: {},
  topicLoadingIds: [],
  topicMaps: {},
  topicSearchKeywords: '',
  topicTitleSummaryOperations: {},
  topicsInit: false,
};
