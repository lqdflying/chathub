import { t } from 'i18next';

import { ChatTopic, ChatTopicSummary, GroupedTopic } from '@/types/topic';
import { getTopicActivityTimestamp, groupTopicsByTime } from '@/utils/client/topic';

import { ChatStoreState } from '../../initialState';
import { messageMapKey } from '../../utils/messageMapKey';

const sortTopicsByActivity = (topics: ChatTopic[]): ChatTopic[] =>
  topics.slice().sort((firstTopic, secondTopic) => {
    const favoriteDifference = Number(secondTopic.favorite) - Number(firstTopic.favorite);
    if (favoriteDifference !== 0) return favoriteDifference;

    return getTopicActivityTimestamp(secondTopic) - getTopicActivityTimestamp(firstTopic);
  });

const currentTopics = (s: ChatStoreState): ChatTopic[] | undefined => s.topicMaps[s.activeId];

const currentActiveTopic = (s: ChatStoreState): ChatTopic | undefined => {
  return currentTopics(s)?.find((topic) => topic.id === s.activeTopicId);
};
const searchTopics = (s: ChatStoreState): ChatTopic[] => sortTopicsByActivity(s.searchTopics);

const displayTopics = (s: ChatStoreState): ChatTopic[] | undefined => {
  const topics = currentTopics(s);
  return topics ? sortTopicsByActivity(topics) : undefined;
};

const currentFavTopics = (s: ChatStoreState): ChatTopic[] =>
  sortTopicsByActivity(currentTopics(s)?.filter((topic) => topic.favorite) || []);

const currentUnFavTopics = (s: ChatStoreState): ChatTopic[] =>
  sortTopicsByActivity(currentTopics(s)?.filter((topic) => !topic.favorite) || []);

const currentTopicLength = (s: ChatStoreState): number => currentTopics(s)?.length || 0;

const getTopicById =
  (id: string) =>
  (s: ChatStoreState): ChatTopic | undefined =>
    currentTopics(s)?.find((topic) => topic.id === id);

const currentActiveTopicSummary = (s: ChatStoreState): ChatTopicSummary | undefined => {
  const activeTopic = currentActiveTopic(s);
  if (!activeTopic) return undefined;

  return {
    content: activeTopic.historySummary || '',
    model: activeTopic.metadata?.model || '',
    provider: activeTopic.metadata?.provider || '',
  };
};

const isCreatingTopic = (s: ChatStoreState) => s.creatingTopic;
const isUndefinedTopics = (s: ChatStoreState) => !currentTopics(s);
const isInSearchMode = (s: ChatStoreState) => s.inSearchingMode;
const isSearchingTopic = (s: ChatStoreState) => s.isSearchingTopic;
const isTopicLoading =
  (topicId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = s.serverGenerationOperations[messageMapKey(s.activeId, topicId)];

    return s.topicLoadingIds.includes(topicId) || Object.keys(operations || {}).length > 0;
  };

const groupedTopicsSelector = (s: ChatStoreState): GroupedTopic[] => {
  const topics = displayTopics(s);

  if (!topics) return [];
  const favTopics = currentFavTopics(s);
  const unfavTopics = currentUnFavTopics(s);

  return favTopics.length > 0
    ? [
        {
          children: favTopics,
          id: 'favorite',
          title: t('favorite', { ns: 'topic' }),
        },
        ...groupTopicsByTime(unfavTopics),
      ]
    : groupTopicsByTime(topics);
};

export const topicSelectors = {
  currentActiveTopic,
  currentActiveTopicSummary,
  currentTopicLength,
  currentTopics,
  currentUnFavTopics,
  displayTopics,
  getTopicById,
  groupedTopicsSelector,
  isCreatingTopic,
  isInSearchMode,
  isSearchingTopic,
  isTopicLoading,
  isUndefinedTopics,
  searchTopics,
};
