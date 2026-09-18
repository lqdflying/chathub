import { LOADING_FLAT } from '@lobechat/const';
import { isConversationGenerationChatFamilyKind } from '@lobechat/types';

import { laneScopedClearKey } from '@/store/chat/utils/conversationClearGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import type { ChatStoreState } from '../../initialState';
import type { ServerGenerationOperation } from '../topic/initialState';

export const PLANNING_NEXT_STEP_SLOW_MS = 20_000;
export const CONVERSATION_GENERATION_STOP_REASON = 'conversationGenerationStopReason';

const isMessageInReasoning = (id: string) => (s: ChatStoreState) =>
  s.reasoningLoadingIds.includes(id);

const isMessageInSearchWorkflow = (id: string) => (s: ChatStoreState) =>
  s.searchWorkflowLoadingIds.includes(id);

const isIntentUnderstanding = (id: string) => (s: ChatStoreState) =>
  isMessageInSearchWorkflow(id)(s);

const findAttachedOperationForAssistant = (s: ChatStoreState, id: string) => {
  for (const operations of Object.values(s.serverGenerationOperations)) {
    for (const operation of Object.values(operations)) {
      if (operation.assistantMessageId === id) return operation as ServerGenerationOperation;
    }
  }
  return undefined;
};

const findMessageInMaps = (s: ChatStoreState, id: string) => {
  for (const messages of Object.values(s.messagesMap || {})) {
    const found = messages.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
};

const isEmptyAssistantContent = (content?: string | null) =>
  !content || content === LOADING_FLAT;

const isMessagePlanningNextStep = (id: string) => (s: ChatStoreState) => {
  if (isMessageInSearchWorkflow(id)(s)) return false;
  if (s.messageRAGLoadingIds.includes(id)) return false;

  const message = findMessageInMaps(s, id);
  if (message?.tools?.length) return false;

  const attached = findAttachedOperationForAssistant(s, id);
  if (attached && isConversationGenerationChatFamilyKind(attached.kind)) {
    if (attached.phase === 'retrieving') return false;
    if (attached.phase === 'planning') return true;
    if (attached.phase === 'model' && isEmptyAssistantContent(message?.content)) return true;
  }

  if (!s.chatLoadingIds.includes(id)) return false;
  return isEmptyAssistantContent(message?.content);
};

const getPlanningNextStepEnteredAt = (id: string) => (s: ChatStoreState) =>
  findAttachedOperationForAssistant(s, id)?.phaseEnteredAt;

const isMessageToolCap = (id: string) => (s: ChatStoreState) => {
  const message = findMessageInMaps(s, id);
  return (
    (message?.metadata as Record<string, unknown> | undefined)?.[
      CONVERSATION_GENERATION_STOP_REASON
    ] === 'tool_cap'
  );
};

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
  getPlanningNextStepEnteredAt,
  isActiveTopicMemoryCompacting,
  isCurrentPreSendCompacting,
  isCurrentSendMessageError,
  isCurrentSendMessageLoading,
  isIntentUnderstanding,
  isMessageInReasoning,
  isMessageInSearchWorkflow,
  isMessagePlanningNextStep,
  isMessageToolCap,
  isSendMessageLoadingForTopic,
};
