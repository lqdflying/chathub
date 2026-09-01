import { laneScopedClearKey } from '@/store/chat/utils/conversationClearGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import type { ChatStoreState } from '../../initialState';

const isMessageInReasoning = (id: string) => (s: ChatStoreState) =>
  s.reasoningLoadingIds.includes(id);

const isMessageInSearchWorkflow = (id: string) => (s: ChatStoreState) =>
  s.searchWorkflowLoadingIds.includes(id);

const isIntentUnderstanding = (id: string) => (s: ChatStoreState) =>
  isMessageInSearchWorkflow(id)(s);

const isCurrentSendMessageLoading = (s: ChatStoreState) => {
  const operationKey = messageMapKey(s.activeId, s.activeTopicId);
  return s.mainSendMessageOperations[operationKey]?.isLoading || false;
};

const isCurrentSendMessageError = (s: ChatStoreState) => {
  const operationKey = messageMapKey(s.activeId, s.activeTopicId);
  return s.mainSendMessageOperations[operationKey]?.inputSendErrorMsg;
};

const isSendMessageLoadingForTopic = (topicKey: string) => (s: ChatStoreState) =>
  s.mainSendMessageOperations[topicKey]?.isLoading ?? false;

const isCurrentPreSendCompacting = (s: ChatStoreState) => {
  const operationKey = messageMapKey(s.activeId, s.activeTopicId);
  return !!s.preSendCompactionOperations[operationKey];
};

/** True while active-topic memory compaction is enqueuing or attached as a durable job. */
const isActiveTopicMemoryCompacting = (s: ChatStoreState) => {
  if (!s.activeId || !s.activeTopicId) return false;

  const mapKey = messageMapKey(s.activeId, s.activeTopicId);
  const hasAttached = Object.values(s.serverGenerationOperations[mapKey] || {}).some(
    (operation) => operation.kind === 'memory_compaction',
  );
  if (hasAttached) return true;

  const laneKey = laneScopedClearKey(s.activeId, s.activeTopicId, null);
  return (s.durableInFlightEnqueues[laneKey] || []).some(
    (entry) => entry.kind === 'memory_compaction',
  );
};

export const aiChatSelectors = {
  isActiveTopicMemoryCompacting,
  isCurrentPreSendCompacting,
  isCurrentSendMessageError,
  isCurrentSendMessageLoading,
  isIntentUnderstanding,
  isMessageInReasoning,
  isMessageInSearchWorkflow,
  isSendMessageLoadingForTopic,
};
