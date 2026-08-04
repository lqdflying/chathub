import { chainRewriteQuery } from '@lobechat/prompts';
import { StateCreator } from 'zustand/vanilla';

import { chatService } from '@/services/chat';
import { ragService } from '@/services/rag';
import { ragProviderService } from '@/services/ragProvider';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { toggleBooleanList } from '@/store/chat/utils';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { ChatSemanticSearchChunk } from '@/types/chunk';

export interface ChatRAGAction {
  deleteUserMessageRagQuery: (id: string) => Promise<void>;
  /**
   * Retrieve chunks from semantic search
   */
  internal_retrieveChunks: (
    id: string,
    userQuery: string,
    messages: string[],
  ) => Promise<{ chunks: ChatSemanticSearchChunk[]; queryId?: string; rewriteQuery?: string }>;
  /**
   * Rewrite user content to better RAG query
   */
  internal_rewriteQuery: (id: string, content: string, messages: string[]) => Promise<string>;

  /**
   * Check if we should use RAG
   */
  internal_shouldUseRAG: () => boolean;
  internal_toggleMessageRAGLoading: (loading: boolean, id: string) => void;
  rewriteQuery: (id: string) => Promise<void>;
}

const knowledgeIds = () => agentSelectors.currentKnowledgeIds(useAgentStore.getState());
const hasEnabledKnowledge = () => agentSelectors.hasEnabledKnowledge(useAgentStore.getState());

export const chatRag: StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatRAGAction> = (
  set,
  get,
) => ({
  deleteUserMessageRagQuery: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      !!chatSelectors.getMessageById(id)(get());
    const message = chatSelectors.getMessageById(id)(get());

    if (!message || !message.ragQueryId || !isCurrentRequest()) return;

    // optimistic update the message's ragQuery
    get().internal_dispatchMessage({
      id,
      type: 'updateMessage',
      value: { ragQuery: null },
    });

    await ragService.deleteMessageRagQuery(message.ragQueryId);
    if (isCurrentRequest()) await get().refreshMessages();
  },

  internal_retrieveChunks: async (id, userQuery, messages) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return { chunks: [] };

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      !!chatSelectors.getMessageById(id)(get());
    if (!isCurrentRequest()) return { chunks: [] };

    get().internal_toggleMessageRAGLoading(true, id);

    try {
      const status = await ragProviderService.getStatus();
      if (!status.configured) {
        throw new Error('RAG retrieval is unavailable. Configure a RAG Provider in Settings.');
      }

      const message = chatSelectors.getMessageById(id)(get());

      // 1. get the rewrite query
      let rewriteQuery = message?.ragQuery as string | undefined;

      // if there is no ragQuery and there is a chat history
      // we need to rewrite the user message to get better results
      if (!message?.ragQuery && messages.length > 0) {
        rewriteQuery = await get().internal_rewriteQuery(id, userQuery, messages);
        if (!isCurrentRequest()) return { chunks: [] };
      }

      // 2. retrieve chunks from semantic search
      const files = chatSelectors.currentUserFiles(get()).map((f) => f.id);
      const { chunks, queryId } = await ragService.semanticSearchForChat({
        fileIds: knowledgeIds().fileIds.concat(files),
        knowledgeIds: knowledgeIds().knowledgeBaseIds,
        messageId: id,
        rewriteQuery: rewriteQuery || userQuery,
        userQuery,
      });

      if (!isCurrentRequest()) return { chunks: [] };

      return { chunks, queryId, rewriteQuery };
    } finally {
      if (isCurrentRequest()) get().internal_toggleMessageRAGLoading(false, id);
    }
  },
  internal_rewriteQuery: async (id, content, messages) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return content;

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      !!chatSelectors.getMessageById(id)(get());
    if (!isCurrentRequest()) return content;

    let rewriteQuery = content;

    const queryRewriteConfig = systemAgentSelectors.queryRewrite(useUserStore.getState());
    if (!queryRewriteConfig.enabled) return content;

    const rewriteQueryParams = {
      model: queryRewriteConfig.model,
      provider: queryRewriteConfig.provider,
      ...chainRewriteQuery(
        content,
        messages,
        !!queryRewriteConfig.customPrompt ? queryRewriteConfig.customPrompt : undefined,
      ),
    };

    let ragQuery = '';
    await chatService.fetchPresetTaskResult({
      onFinish: async (text) => {
        if (!isCurrentRequest()) return;
        rewriteQuery = text;
      },

      onMessageHandle: (chunk) => {
        if (!isCurrentRequest()) return;
        if (chunk.type !== 'text') return;
        ragQuery += chunk.text;

        get().internal_dispatchMessage({
          id,
          type: 'updateMessage',
          value: { ragQuery },
        });
      },
      params: rewriteQueryParams,
    });

    return isCurrentRequest() ? rewriteQuery : content;
  },
  internal_shouldUseRAG: () => {
    //  if there is enabled knowledge, try with ragQuery
    return hasEnabledKnowledge();
  },

  internal_toggleMessageRAGLoading: (loading, id) => {
    set(
      {
        messageRAGLoadingIds: toggleBooleanList(get().messageRAGLoadingIds, id, loading),
      },
      false,
      'internal_toggleMessageLoading',
    );
  },

  rewriteQuery: async (id) => {
    const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
    if (!accountMutationSnapshot) return;

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      !!chatSelectors.getMessageById(id)(get());
    const message = chatSelectors.getMessageById(id)(get());
    if (!message || !isCurrentRequest()) return;

    // delete the current ragQuery
    await get().deleteUserMessageRagQuery(id);
    if (!isCurrentRequest()) return;

    const chats = chatSelectors.mainAIChatsWithHistoryConfig(get());

    await get().internal_rewriteQuery(
      id,
      message.content,
      chats.map((m) => m.content),
    );
  },
});
