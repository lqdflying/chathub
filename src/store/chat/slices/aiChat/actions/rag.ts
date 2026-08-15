import { chainRewriteQuery } from '@lobechat/prompts';
import {
  RAG_CHAT_CANDIDATE_LIMIT,
  RAG_CHAT_MINIMUM_SIMILARITY,
  RAG_CHAT_RESULT_LIMIT,
  RagChatRetrievalStats,
  RagChatScopeStats,
} from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { chatService } from '@/services/chat';
import { ragService } from '@/services/rag';
import { ragProviderService } from '@/services/ragProvider';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import type { ConversationContext } from '@/store/chat/types';
import { toggleBooleanList } from '@/store/chat/utils';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { ChatSemanticSearchChunk } from '@/types/chunk';

export interface ChatRagRetrievalResult {
  chunks: ChatSemanticSearchChunk[];
  diagnosticId?: string;
  queryId?: string;
  retrieval: RagChatRetrievalStats;
  rewriteQuery?: string;
  scope: RagChatScopeStats;
}

const emptyRetrievalStats = (): RagChatRetrievalStats => ({
  candidateCount: 0,
  candidateLimit: RAG_CHAT_CANDIDATE_LIMIT,
  eligibleCount: 0,
  minimumSimilarity: RAG_CHAT_MINIMUM_SIMILARITY,
  resultLimit: RAG_CHAT_RESULT_LIMIT,
  selectedCount: 0,
  selectedScores: [],
  strategy: 'cosine',
});

const emptyScopeStats = (): RagChatScopeStats => ({
  directFileCount: 0,
  expandedFileCount: 0,
  knowledgeBaseCount: 0,
});

export interface ChatRAGAction {
  deleteUserMessageRagQuery: (id: string) => Promise<void>;
  /**
   * Retrieve chunks from semantic search
   */
  internal_retrieveChunks: (
    id: string,
    userQuery: string,
    messages: string[],
  ) => Promise<ChatRagRetrievalResult>;
  /**
   * Rewrite user content to better RAG query
   */
  internal_rewriteQuery: (id: string, content: string, messages: string[]) => Promise<string>;
  internal_setKnowledgeBaseContextTokens: (
    conversationContext: Pick<ConversationContext, 'sessionId' | 'topicId'>,
    tokens: number,
  ) => void;

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
    if (!accountMutationSnapshot) {
      return { chunks: [], retrieval: emptyRetrievalStats(), scope: emptyScopeStats() };
    }

    const requestedGeneration = get().conversationClearGeneration;
    const requestedSessionId = get().activeId;
    const requestedTopicId = get().activeTopicId;
    const isCurrentRequest = () =>
      isAccountMutationCurrent(useUserStore.getState(), accountMutationSnapshot) &&
      get().conversationClearGeneration === requestedGeneration &&
      get().activeId === requestedSessionId &&
      get().activeTopicId === requestedTopicId &&
      !!chatSelectors.getMessageById(id)(get());
    if (!isCurrentRequest()) {
      return { chunks: [], retrieval: emptyRetrievalStats(), scope: emptyScopeStats() };
    }

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
        if (!isCurrentRequest()) {
          return { chunks: [], retrieval: emptyRetrievalStats(), scope: emptyScopeStats() };
        }
      }

      // 2. retrieve chunks from semantic search
      const files = chatSelectors.currentUserFiles(get()).map((f) => f.id);
      const result = await ragService.semanticSearchForChat({
        fileIds: knowledgeIds().fileIds.concat(files),
        knowledgeIds: knowledgeIds().knowledgeBaseIds,
        messageId: id,
        rewriteQuery: rewriteQuery || userQuery,
        userQuery,
      });

      if (!isCurrentRequest()) {
        return { chunks: [], retrieval: emptyRetrievalStats(), scope: emptyScopeStats() };
      }

      return {
        chunks: result.chunks,
        diagnosticId: result.diagnosticId,
        queryId: result.queryId,
        retrieval: result.retrieval ?? emptyRetrievalStats(),
        rewriteQuery,
        scope: result.scope ?? emptyScopeStats(),
      };
    } finally {
      // Only clear the flag if this is still the current request. The orphan
      // case (invalidated mid-retrieval) is now handled by
      // internal_invalidateConversation clearing messageRAGLoadingIds; keeping
      // the guard here prevents a stale request A from clearing the loading flag
      // of a newer request B that reused the same message id after invalidation.
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
  internal_setKnowledgeBaseContextTokens: (conversationContext, tokens) => {
    const key = messageMapKey(conversationContext.sessionId, conversationContext.topicId);
    const current = get().knowledgeBaseContextTokens;
    if (tokens > 0) {
      set(
        { knowledgeBaseContextTokens: { ...current, [key]: tokens } },
        false,
        'internal_setKnowledgeBaseContextTokens',
      );
      return;
    }

    const rest = { ...current };
    Reflect.deleteProperty(rest, key);
    set({ knowledgeBaseContextTokens: rest }, false, 'internal_setKnowledgeBaseContextTokens');
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
