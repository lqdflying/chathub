import { t } from 'i18next';

import { LOADING_FLAT } from '@/const/message';
import { ChatTopic, ChatTopicSummary, GroupedTopic } from '@/types/topic';
import { getTopicActivityTimestamp, groupTopicsByTime } from '@/utils/client/topic';

import { ChatStoreState } from '../../initialState';
import { deferredBrowserGenerationLaneKeysForTopic } from '../../utils/deferredBrowserGeneration';
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

const hasActiveToolStream = (s: ChatStoreState, messageId: string): boolean => {
  const flags = s.toolCallingStreamIds?.[messageId];
  return Array.isArray(flags) && flags.some(Boolean);
};

const topicHasPendingToolLoop = (
  s: ChatStoreState,
  mapKey: string,
  assistantMessageId: string,
): boolean => {
  const messages = s.messagesMap[mapKey] || [];
  const assistant = messages.find((message) => message.id === assistantMessageId);
  if (!assistant?.tools?.length) return false;

  return !messages.some(
    (message) => message.role === 'tool' && message.parentId === assistantMessageId,
  );
};

const isDeferredBrowserTopicBusy = (
  s: ChatStoreState,
  topicId: string | null,
  mapKey: string,
): boolean => {
  const laneKeys = deferredBrowserGenerationLaneKeysForTopic(
    s.deferredBrowserGenerationLanes,
    s.activeId,
    topicId,
  );

  return laneKeys.some((laneKey) => {
    const lane = s.deferredBrowserGenerationLanes[laneKey];
    if (!lane) return false;

    const assistantId = lane.assistantMessageId;
    if (s.chatLoadingIds.includes(assistantId)) return true;
    if (s.messageInToolsCallingIds.includes(assistantId)) return true;
    if (hasActiveToolStream(s, assistantId)) return true;

    const assistant = (s.messagesMap[mapKey] || []).find((message) => message.id === assistantId);
    if (assistant?.content === LOADING_FLAT) return true;

    return topicHasPendingToolLoop(s, mapKey, assistantId);
  });
};

/**
 * True while this topic still has in-flight work: CRUD, a durable server job,
 * browser-fallback generation, tool/plugin calls, or a leftover loading
 * placeholder. The topic list uses this to spin the item icon.
 */
const isTopicLoading =
  (topicId?: string | null) =>
  (s: ChatStoreState): boolean => {
    const resolvedTopicId = topicId ?? null;
    if (resolvedTopicId && s.topicLoadingIds.includes(resolvedTopicId)) return true;

    const mapKey = messageMapKey(s.activeId, resolvedTopicId);
    const operations = s.serverGenerationOperations[mapKey];
    if (Object.keys(operations || {}).length > 0) return true;
    if (s.mainSendMessageOperations[mapKey]?.isLoading) return true;

    const lanePrefix = `${mapKey}:`;
    if (
      Object.values(s.chatLoadingLaneByMessageId || {}).some((laneKey) =>
        laneKey.startsWith(lanePrefix),
      )
    ) {
      return true;
    }

    if (isDeferredBrowserTopicBusy(s, resolvedTopicId, mapKey)) return true;

    const loadingIds = new Set([
      ...(s.chatLoadingIds || []),
      ...(s.pluginApiLoadingIds || []),
      ...(s.messageInToolsCallingIds || []),
      ...(s.reasoningLoadingIds || []),
      ...(s.messageRAGLoadingIds || []),
      ...(s.searchWorkflowLoadingIds || []),
    ]);
    if (loadingIds.size === 0) return false;

    return (s.messagesMap[mapKey] || []).some((message) => loadingIds.has(message.id));
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
