import { ChatTopic } from '@/types/topic';

import type { TitleSummaryOperation } from '../../types';

export interface ServerGenerationOperation {
  generation: number;
  operationId: string;
  sessionId: string;
  topicId: string;
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
