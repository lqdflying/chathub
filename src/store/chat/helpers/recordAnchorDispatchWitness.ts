import type { LobeAgentConfig } from '@lobechat/types';

import { computeFixedContextOverheadInput } from '@/helpers/estimateContextUsageAsync';
import {
  recordAnchorRequestWitness,
  resolveSelectedPreAnchorIds,
} from '@/helpers/reportedContextTokens';
import { ChatStoreState } from '@/store/chat/initialState';
import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  resolveConversationAgentRuntime,
  resolveEnableHistoryCountForAgent,
} from './resolveConversationAgentRuntime';

export interface AnchorDispatchEvidence {
  cursorId?: string;
  enableHistoryCount: boolean;
  fixedOverheadTokens: number;
  historyCount?: number;
  /** Normalized `chatConfig.inputTemplate` frozen with the sent request (U3). */
  inputTemplate: string;
}

/**
 * Freeze the sent request's overhead and history-window inputs. Call this
 * with the agent config that is about to be enqueued — before any await that
 * can observe later UI edits (T1). Commit associates the evidence with the
 * assistant id after the RPC returns.
 */
export const captureAnchorDispatchEvidence = async ({
  agentConfig,
  chatState,
  conversation,
  isGroupSession,
}: {
  agentConfig: LobeAgentConfig;
  chatState: ChatStoreState;
  conversation: { sessionId: string; threadId?: string | null; topicId?: string | null };
  isGroupSession: boolean;
}): Promise<AnchorDispatchEvidence | undefined> => {
  try {
    const { sessionId, threadId, topicId } = conversation;
    const enableHistoryCount = resolveEnableHistoryCountForAgent(agentConfig);
    const chatConfig = agentConfig.chatConfig || {};
    const topic = topicId
      ? chatState.topicMaps[sessionId]?.find((item) => item.id === topicId)
      : undefined;
    const overhead = await computeFixedContextOverheadInput({
      agentConfig,
      chatState,
      enableHistoryCount,
      isGroupSession,
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

    return {
      cursorId:
        enableHistoryCount && chatConfig.enableCompressHistory
          ? topic?.metadata?.historySummaryLastMessageId
          : undefined,
      enableHistoryCount,
      fixedOverheadTokens: overhead.fixedOverheadTokens,
      historyCount: chatConfig.historyCount,
      inputTemplate: chatConfig.inputTemplate?.trim() || '',
    };
  } catch {
    return undefined;
  }
};

/**
 * Bind already-captured sent-settings evidence to the assistant row. Uses
 * the frozen history window (not live store settings) so a mid-RPC
 * instruction or limit edit cannot rewrite what the worker will send.
 * Post-refresh `chatState` supplies stable server ids for the fingerprint.
 */
export const commitAnchorDispatchWitness = ({
  assistantMessageId,
  chatState,
  conversation,
  evidence,
  parentMessageId,
}: {
  assistantMessageId?: string;
  chatState: ChatStoreState;
  conversation: { sessionId: string; threadId?: string | null; topicId?: string | null };
  evidence?: AnchorDispatchEvidence;
  parentMessageId?: string;
}): void => {
  try {
    if (!assistantMessageId || !evidence) return;
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
    if (parentId && !messages.some((message) => message.id === parentId)) return;

    const parentIndex = parentId ? messages.findIndex(({ id }) => id === parentId) : -1;
    const prefix = parentIndex >= 0 ? messages.slice(0, parentIndex + 1) : [];
    const cursorIndex = evidence.cursorId
      ? messages.findIndex((message) => message.id === evidence.cursorId)
      : -1;
    const afterCursor = cursorIndex >= 0 ? messages.slice(cursorIndex + 1) : messages;
    // `slice(-0)` is `slice(0)` and would record every row. Request assembly
    // (`getSlicedMessages`) returns [] for any enabled count <= 0.
    const selected =
      evidence.enableHistoryCount && typeof evidence.historyCount === 'number'
        ? evidence.historyCount <= 0
          ? []
          : afterCursor.slice(-evidence.historyCount)
        : afterCursor;

    recordAnchorRequestWitness({
      assistantMessageId,
      conversationKey: messageMapKey(sessionId, topicId),
      fixedOverheadTokens: evidence.fixedOverheadTokens,
      inputTemplate: evidence.inputTemplate,
      messages,
      parentMessageId: parentId,
      selectedPrefixIds: resolveSelectedPreAnchorIds({
        prefixMessages: prefix,
        selectedMessages: selected,
      }),
    });
  } catch {
    // Diagnostics must never interrupt dispatch.
  }
};

/**
 * Record the dispatch-time anchor witness for a request (D2/T1). Called by the
 * send / retry / tool-continuation paths at the moment the request is
 * assembled — the estimators never record witnesses, so a provider report can
 * only be promoted to an anchor baseline when this process actually dispatched
 * the request it answers, in this conversation, with an unchanged prefix.
 *
 * The witness binds: the pending assistant row id, its parent row, the
 * conversation key, the fixed overhead (same shared-unit assembly the
 * estimators use), the fingerprint of the full prefix through the parent,
 * the selected pre-anchor ids the request included, and the input template
 * applied to those user rows.
 *
 * Best effort: any failure (store not refreshed yet, skill resolution, …)
 * simply skips the witness — the report then falls back to the whole-window
 * estimate, which is the safe default for an unverifiable association. This
 * must never break dispatch.
 *
 * Browser retry/continuation uses this convenience (live settings *are* the
 * request). Durable enqueue must `capture` before the RPC and `commit` after
 * so a mid-wait settings edit cannot undercount.
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
    const { sessionId } = conversation;
    const agentRuntime = resolveConversationAgentRuntime(sessionId);
    const evidence = await captureAnchorDispatchEvidence({
      agentConfig: agentRuntime.agentConfig,
      chatState,
      conversation,
      isGroupSession: agentRuntime.isGroupSession,
    });
    commitAnchorDispatchWitness({
      assistantMessageId,
      chatState,
      conversation,
      evidence,
      parentMessageId,
    });
  } catch {
    // Diagnostics must never interrupt dispatch.
  }
};
