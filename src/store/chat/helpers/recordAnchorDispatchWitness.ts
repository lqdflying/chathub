import {
  computeFixedContextOverheadInput,
} from '@/helpers/estimateContextUsageAsync';
import { recordAnchorRequestWitness } from '@/helpers/reportedContextTokens';
import { ChatStoreState } from '@/store/chat/initialState';
import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  resolveConversationAgentRuntime,
  resolveEnableHistoryCountForAgent,
} from './resolveConversationAgentRuntime';

/**
 * Record the dispatch-time anchor witness for a request (D2/T1). Called by the
 * send / retry / tool-continuation paths at the moment the request is
 * assembled — the estimators never record witnesses, so a provider report can
 * only be promoted to an anchor baseline when this process actually dispatched
 * the request it answers, in this conversation, with an unchanged prefix.
 *
 * The witness binds: the pending assistant row id, its parent row, the
 * conversation key, the fixed overhead (same shared-unit assembly the
 * estimators use) and the fingerprint of the full prefix through the parent.
 *
 * Best effort: any failure (store not refreshed yet, skill resolution, …)
 * simply skips the witness — the report then falls back to the whole-window
 * estimate, which is the safe default for an unverifiable association. This
 * must never break dispatch.
 */
export const recordAnchorDispatchWitness = async ({
  assistantMessageId,
  chatState,
  conversation,
  parentMessageId,
}: {
  assistantMessageId?: string;
  chatState: ChatStoreState;
  conversation: { sessionId: string; threadId?: string | null; topicId?: string | null };
  /** Explicit parent row; when omitted, the assistant's current predecessor is used. */
  parentMessageId?: string;
}): Promise<void> => {
  try {
    if (!assistantMessageId) return;
    const { sessionId, threadId, topicId } = conversation;
    const messages = chatSelectors.conversationAIChats(
      sessionId,
      topicId,
      threadId ?? undefined,
    )(chatState);

    let parentId = parentMessageId;
    if (!parentId) {
      const assistantIndex = messages.findIndex(({ id }) => id === assistantMessageId);
      if (assistantIndex < 0) return;
      parentId = assistantIndex > 0 ? messages[assistantIndex - 1]?.id : undefined;
    }

    const agentRuntime = resolveConversationAgentRuntime(sessionId);
    const overhead = await computeFixedContextOverheadInput({
      agentConfig: agentRuntime.agentConfig,
      chatState,
      enableHistoryCount: resolveEnableHistoryCountForAgent(agentRuntime.agentConfig),
      isGroupSession: agentRuntime.isGroupSession,
      sessionId,
      // Never call skill tRPC from the send path — a hung/unmocked resolve
      // would block dispatch. Skill instruction text is omitted; if the
      // same skills stay selected, the later estimate over-counts them
      // (safe: cannot hide overflow). Mid-generation skill *adds* still
      // appear in the displayed total via the whole-window fallback when
      // the prefix/overhead no longer matches a skills-inclusive report.
      skipSkills: true,
      threadId,
      topicId,
    });

    recordAnchorRequestWitness({
      assistantMessageId,
      conversationKey: messageMapKey(sessionId, topicId),
      fixedOverheadTokens: overhead.fixedOverheadTokens,
      messages,
      parentMessageId: parentId,
    });
  } catch {
    // Diagnostics must never interrupt dispatch.
  }
};
