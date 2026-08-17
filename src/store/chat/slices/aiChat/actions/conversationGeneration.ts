import type { ConversationGenerationEvent, ConversationGenerationOperation } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { conversationGenerationService } from '@/services/conversationGeneration';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { toggleBooleanList } from '@/store/chat/utils';
import { setNamespace } from '@/utils/storeDebug';

import type { ServerGenerationOperation } from '../../topic/initialState';

const n = setNamespace('durableGeneration');

export interface ConversationGenerationAction {
  applyConversationGenerationEvent: (event: ConversationGenerationEvent) => void;
  attachConversationGeneration: (operation: ServerGenerationOperation) => void;
  detachConversationGeneration: (operationId: string, conversationKey?: string) => void;
  internal_markDurableGenerating: (id: string, loading: boolean) => void;
  stopDurableConversationGeneration: (options?: { threadId?: string | null }) => void;
  syncActiveConversationGenerations: () => Promise<void>;
}

const conversationKeyFor = (sessionId?: string | null, topicId?: string | null) =>
  messageMapKey(sessionId || '', topicId);

export const conversationGeneration: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ConversationGenerationAction
> = (set, get) => ({
  applyConversationGenerationEvent: (event) => {
    const payload = event.payload || {};
    let assistantMessageId = Object.values(get().serverGenerationOperations)
      .flatMap((ops) => Object.values(ops))
      .find((item) => item.operationId === event.operationId)?.assistantMessageId;

    if (event.type === 'snapshot') {
      if (payload.assistantMessageId && payload.assistantMessageId !== assistantMessageId) {
        if (assistantMessageId) get().internal_markDurableGenerating(assistantMessageId, false);
        get().internal_markDurableGenerating(payload.assistantMessageId as string, true);
        set(
          (state) => {
            const serverGenerationOperations = { ...state.serverGenerationOperations };
            for (const [key, ops] of Object.entries(serverGenerationOperations)) {
              const current = ops[event.operationId];
              if (!current) continue;
              serverGenerationOperations[key] = {
                ...ops,
                [event.operationId]: {
                  ...current,
                  assistantMessageId: payload.assistantMessageId as string,
                },
              };
            }
            return { serverGenerationOperations };
          },
          false,
          n('applyAssistantId'),
        );
        assistantMessageId = payload.assistantMessageId as string;
      }
      if (assistantMessageId && (payload.content !== undefined || payload.reasoning)) {
        get().internal_dispatchMessage({
          id: assistantMessageId,
          type: 'updateMessage',
          value: {
            ...(payload.content !== undefined ? { content: payload.content as string } : {}),
            ...(payload.reasoning ? { reasoning: payload.reasoning as any } : {}),
          },
        });
      }
      if (payload.title && payload.topicId) {
        const topicId = payload.topicId as string;
        const title = payload.title as string;
        set(
          (state) => ({
            topicMaps: Object.fromEntries(
              Object.entries(state.topicMaps).map(([containerId, topics]) => [
                containerId,
                topics.map((topic) => (topic.id === topicId ? { ...topic, title } : topic)),
              ]),
            ),
          }),
          false,
          n('applyTitleSnapshot'),
        );
      }
      if (payload.translate && payload.messageId) {
        get().internal_dispatchMessage({
          id: payload.messageId as string,
          key: 'translate',
          type: 'updateMessageExtra',
          value: payload.translate,
        });
      }
    }

    if (event.type === 'done' || event.type === 'error') {
      if (assistantMessageId) {
        get().internal_markDurableGenerating(assistantMessageId, false);
      }
      const attached = Object.values(get().serverGenerationOperations)
        .flatMap((ops) => Object.values(ops))
        .find((item) => item.operationId === event.operationId);
      if (attached?.groupId) {
        get().internal_toggleSupervisorLoading(false, attached.groupId);
      }
      get().detachConversationGeneration(event.operationId);
      void get().refreshMessages();
      void get().refreshTopic();
    }
  },

  attachConversationGeneration: (operation) => {
    const key = conversationKeyFor(operation.sessionId, operation.topicId);
    set(
      (state) => ({
        serverGenerationOperations: {
          ...state.serverGenerationOperations,
          [key]: {
            ...state.serverGenerationOperations[key],
            [operation.operationId]: operation,
          },
        },
      }),
      false,
      n('attach', { operationId: operation.operationId }),
    );
    if (operation.assistantMessageId) {
      get().internal_markDurableGenerating(operation.assistantMessageId, true);
    }
  },

  detachConversationGeneration: (operationId, conversationKey) => {
    set(
      (state) => {
        const serverGenerationOperations = { ...state.serverGenerationOperations };
        const keys = conversationKey ? [conversationKey] : Object.keys(serverGenerationOperations);
        for (const key of keys) {
          const current = serverGenerationOperations[key];
          if (!current?.[operationId]) continue;
          const remaining = { ...current };
          delete remaining[operationId];
          if (Object.keys(remaining).length === 0) delete serverGenerationOperations[key];
          else serverGenerationOperations[key] = remaining;
        }
        return { serverGenerationOperations };
      },
      false,
      n('detach', { operationId }),
    );
  },

  internal_markDurableGenerating: (id, loading) => {
    set(
      {
        chatLoadingIds: toggleBooleanList(get().chatLoadingIds, id, loading),
      },
      false,
      n(loading ? 'generating/start' : 'generating/end', { id }),
    );
  },

  stopDurableConversationGeneration: (options) => {
    const { activeId, activeTopicId, activeThreadId, serverGenerationOperations } = get();
    if ((options?.threadId ?? null) !== (activeThreadId ?? null)) return;
    const key = conversationKeyFor(activeId, activeTopicId);
    const operations = Object.values(serverGenerationOperations[key] || {});
    for (const operation of operations) {
      if (operation.assistantMessageId) {
        get().internal_markDurableGenerating(operation.assistantMessageId, false);
      }
      void conversationGenerationService.cancel(operation.operationId).catch(console.error);
    }
  },

  syncActiveConversationGenerations: async () => {
    const operations = (await conversationGenerationService.listActive()) as Array<
      ConversationGenerationOperation & { assistantMessageId?: string | null }
    >;
    const { activeId, activeTopicId, conversationClearGeneration } = get();
    for (const operation of operations) {
      if (
        (operation.sessionId || activeId) === activeId &&
        (operation.topicId ?? null) === (activeTopicId ?? null)
      ) {
        get().attachConversationGeneration({
          assistantMessageId: operation.assistantMessageId || undefined,
          generation: conversationClearGeneration,
          groupId: operation.groupId || undefined,
          operationId: operation.id,
          sessionId: operation.sessionId || activeId,
          topicId: operation.topicId || undefined,
          userScope: 'current',
        });
      }
    }
  },
});
