import type { LobeChatDatabase } from '@lobechat/database';
import {
  ASSISTANT_MEMORY_DREAM_MAX_OUTPUT_TOKENS,
  ASSISTANT_MEMORY_DREAM_MAX_TOPICS,
  ASSISTANT_MEMORY_NO_CHANGES_SENTINEL,
  chainAssistantMemoryDream,
} from '@lobechat/prompts';
import type { AssistantMemoryMeta, LobeAgentChatConfig } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@/const/settings';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { agents } from '@/database/schemas';
import {
  capAssistantMemoryByTokensAsync,
  normalizeAssistantMemoryText,
} from '@/helpers/assistantMemory';
import { buildSimpleCompletionSampling } from '@/helpers/contextCompaction';
import { logCompactionDebugSafe } from '@/libs/logger/compactionDebug';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { resolveConversationRuntimePayload } from '@/server/services/conversationGeneration/credentials';
import { createConversationRuntimeChatOptions } from '@/server/services/conversationGeneration/runtimeChatOptions';
import { consumeProtocolResponse } from '@/server/services/conversationGeneration/stream';

import { isDreamDue, previousUtcDayWindow } from './schedule';

export interface AssistantMemoryDreamExecuteInput {
  agentId: string;
  db: LobeChatDatabase;
  now?: Date;
  periodStamp: string;
  userId: string;
}

export interface AssistantMemoryDreamExecuteResult {
  activeTopicCount?: number;
  reason?: string;
  status: 'failed' | 'skipped' | 'success';
  topicsWithSummary?: number;
}

type AgentDreamSnapshot = {
  assistantMemory: string | null;
  assistantMemoryMeta: AssistantMemoryMeta;
  updatedAt: Date;
};

const nowISO = () => new Date().toISOString();

const settle = (
  fields: {
    activeTopicCount?: number;
    activityWindowEnd: string;
    activityWindowStart: string;
    reason?: string;
    status: AssistantMemoryDreamExecuteResult['status'];
    topicsWithSummary?: number;
  },
) => {
  logCompactionDebugSafe('dream_scheduler_settled', {
    activeTopicCount: fields.activeTopicCount,
    activityWindowEnd: fields.activityWindowEnd,
    activityWindowStart: fields.activityWindowStart,
    path: 'assistant_memory_rollup',
    reason: fields.reason,
    status: fields.status,
    topicsWithSummary: fields.topicsWithSummary,
    trigger: 'scheduled',
  });
};

const writeAgentMemoryIfUnchanged = async (
  db: LobeChatDatabase,
  agentId: string,
  userId: string,
  snapshot: AgentDreamSnapshot,
  patch: { assistantMemory?: string; assistantMemoryMeta: AssistantMemoryMeta },
) => {
  const updated = await db
    .update(agents)
    .set(patch)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.userId, userId),
        eq(agents.updatedAt, snapshot.updatedAt),
      ),
    )
    .returning({ id: agents.id });

  return updated.length > 0;
};

const loadHistoryCompress = async (db: LobeChatDatabase, userId: string) => {
  try {
    const state = await new UserModel(db, userId).getUserState(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );
    const configured = (
      state.settings?.systemAgent as { historyCompress?: { model: string; provider: string } }
    )?.historyCompress;
    if (configured?.model && configured.provider) return configured;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_SYSTEM_AGENT_CONFIG.historyCompress;
};

const runDreamCompletion = async ({
  db,
  fixed,
  model,
  prior,
  provider,
  topics,
  userId,
}: {
  db: LobeChatDatabase;
  fixed: string;
  model: string;
  prior: string;
  provider: string;
  topics: Array<{ historySummary: string | null; sessionId: string | null; title: string | null }>;
  userId: string;
}) => {
  const runtimePayload = await resolveConversationRuntimePayload({ db, provider, userId });
  const runtime = initModelRuntimeWithUserPayload(provider, runtimePayload);
  const sampling = buildSimpleCompletionSampling({
    model,
    provider,
    summaryMaxTokens: ASSISTANT_MEMORY_DREAM_MAX_OUTPUT_TOKENS,
  });
  const payload = {
    ...chainAssistantMemoryDream({
      fixedMemory: fixed || undefined,
      priorAssistantMemory: prior || undefined,
      topics,
    }),
    ...sampling,
    model,
    stream: true,
  };
  const response = await runtime.chat(
    payload as any,
    createConversationRuntimeChatOptions({
      payload,
      provider: runtimePayload.runtimeProvider ?? provider,
      userId,
    }),
  );
  const result = await consumeProtocolResponse(response);
  if (result.error) {
    throw new Error(result.error.message || result.error.type || 'upstream_error');
  }
  return result.content.trim();
};

export const executeAssistantMemoryDream = async ({
  agentId,
  db,
  now: nowInput,
  periodStamp,
  userId,
}: AssistantMemoryDreamExecuteInput): Promise<AssistantMemoryDreamExecuteResult> => {
  const now = nowInput ?? new Date();
  const { from, to } = previousUtcDayWindow(now);
  const windowStart = from.toISOString().slice(0, 10);
  const windowEnd = to.toISOString().slice(0, 10);

  const [agent] = await db
    .select({
      assistantMemory: agents.assistantMemory,
      assistantMemoryMeta: agents.assistantMemoryMeta,
      chatConfig: agents.chatConfig,
      fixedMemory: agents.fixedMemory,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);

  if (!agent) {
    const result = { reason: 'no_agent', status: 'failed' as const };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
    return result;
  }

  const chatConfig = (agent.chatConfig ?? {}) as LobeAgentChatConfig;
  const meta = (agent.assistantMemoryMeta ?? {}) as AssistantMemoryMeta;
  const snapshot: AgentDreamSnapshot = {
    assistantMemory: agent.assistantMemory,
    assistantMemoryMeta: meta,
    updatedAt: agent.updatedAt,
  };
  const due = isDreamDue({ assistantMemoryMeta: meta, chatConfig, now });

  if (!due.due) {
    const result = { reason: due.skippedReason, status: 'skipped' as const };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
    return result;
  }

  if (due.periodStamp !== periodStamp) {
    const result = { reason: 'stale_job', status: 'skipped' as const };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
    return result;
  }

  const topicModel = new TopicModel(db, userId);
  const activeTopicCount = await topicModel.countTopicsForAssistantMemoryDream({
    activityFrom: from,
    activityTo: to,
    agentId,
  });
  const topics = await topicModel.listTopicsForAssistantMemoryDream({
    activityFrom: from,
    activityTo: to,
    agentId,
    limit: ASSISTANT_MEMORY_DREAM_MAX_TOPICS,
  });

  const writeMarker = async (extra: Partial<AssistantMemoryMeta> = {}) => {
    const wrote = await writeAgentMemoryIfUnchanged(db, agentId, userId, snapshot, {
      assistantMemoryMeta: {
        ...snapshot.assistantMemoryMeta,
        lastDreamMarker: periodStamp,
        lastError: null,
        lastRollupAt: nowISO(),
        ...extra,
      },
    });
    return wrote;
  };

  if (activeTopicCount === 0) {
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'no_active_topics_yesterday',
      status: 'skipped' as const,
    };
    settle({
      ...result,
      activityWindowEnd: windowEnd,
      activityWindowStart: windowStart,
      topicsWithSummary: 0,
    });
    return result;
  }

  if (topics.length === 0) {
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'no_summaries',
      status: 'skipped' as const,
      topicsWithSummary: 0,
    };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
    return result;
  }

  const prior = normalizeAssistantMemoryText(agent.assistantMemory);
  const fixed = (agent.fixedMemory ?? '').trim();
  const { model, provider } = await loadHistoryCompress(db, userId);

  let text = '';
  let failureMessage: string | undefined;
  try {
    text = await runDreamCompletion({
      db,
      fixed,
      model,
      prior,
      provider,
      topics: topics.map((topic) => ({
        historySummary: topic.historySummary,
        sessionId: topic.sessionId,
        title: topic.title,
      })),
      userId,
    });
  } catch (error) {
    failureMessage = (error as Error)?.message || 'request failed';
  }

  const isNoChanges =
    !failureMessage &&
    (text.trim() === ASSISTANT_MEMORY_NO_CHANGES_SENTINEL ||
      normalizeAssistantMemoryText(text) === ASSISTANT_MEMORY_NO_CHANGES_SENTINEL);

  if (isNoChanges) {
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({
        ...result,
        activityWindowEnd: windowEnd,
        activityWindowStart: windowStart,
        topicsWithSummary: topics.length,
      });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'no_changes',
      status: 'skipped' as const,
      topicsWithSummary: topics.length,
    };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
    return result;
  }

  const next = failureMessage ? '' : await capAssistantMemoryByTokensAsync(normalizeAssistantMemoryText(text));
  if (!next) {
    const wrote = await writeAgentMemoryIfUnchanged(db, agentId, userId, snapshot, {
      assistantMemoryMeta: {
        ...snapshot.assistantMemoryMeta,
        lastError: {
          at: nowISO(),
          attempts: (snapshot.assistantMemoryMeta.lastError?.attempts ?? 0) + 1,
          message: failureMessage || 'empty dream output',
        },
      },
    });
    if (!wrote) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({
        ...result,
        activityWindowEnd: windowEnd,
        activityWindowStart: windowStart,
        topicsWithSummary: topics.length,
      });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'completion_failed',
      status: 'failed' as const,
      topicsWithSummary: topics.length,
    };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
    return result;
  }

  const wrote = await writeAgentMemoryIfUnchanged(db, agentId, userId, snapshot, {
    assistantMemory: next,
    assistantMemoryMeta: {
      ...snapshot.assistantMemoryMeta,
      lastDreamMarker: periodStamp,
      lastError: null,
      lastRollupAt: nowISO(),
      previousMemory: prior
        ? { at: nowISO(), text: prior }
        : snapshot.assistantMemoryMeta.previousMemory ?? null,
    },
  });
  if (!wrote) {
    const result = { reason: 'stale_conflict', status: 'skipped' as const };
    settle({
      ...result,
      activityWindowEnd: windowEnd,
      activityWindowStart: windowStart,
      topicsWithSummary: topics.length,
    });
    return result;
  }

  const result = {
    activeTopicCount,
    status: 'success' as const,
    topicsWithSummary: topics.length,
  };
  settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart });
  return result;
};
