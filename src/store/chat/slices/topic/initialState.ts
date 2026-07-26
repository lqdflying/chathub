import { ChatTopic } from '@/types/topic';

import type { TitleSummaryOperation } from '../../types';

export interface ChatTopicState {
  // TODO: need to add the null to the type
  activeTopicId?: string;
  creatingTopic: boolean;
  creatingTopicId?: string;
  inSearchingMode?: boolean;
  isSearchingTopic: boolean;
  searchTopics: ChatTopic[];
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
  topicLoadingIds: [],
  topicMaps: {},
  topicSearchKeywords: '',
  topicTitleSummaryOperations: {},
  topicsInit: false,
};
