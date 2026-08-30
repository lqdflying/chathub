import type { LobeChatDatabase } from '@lobechat/database';
import {
  ASSISTANT_MEMORY_DREAM_MAX_OUTPUT_TOKENS,
  ASSISTANT_MEMORY_DREAM_MAX_TOPICS,
  ASSISTANT_MEMORY_NO_CHANGES_SENTINEL,
  ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS,
  ASSISTANT_MEMORY_OVERFLOW_MAX_OUTPUT_TOKENS,
  chainAssistantMemoryDream,
  chainAssistantMemoryOverflowFold,
} from '@lobechat/prompts';
import type { AssistantMemoryMeta, LobeAgentChatConfig } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@/const/settings';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { agents } from '@/database/schemas';
import {
  appendDreamMemoryEntry,
  assembleDreamMemoryAfterFold,
  capAssistantMemoryByTokensAsync,
  capDreamMemoryDocument,
  enforceDreamMemoryRetention,
  hasDreamMemoryEntryForDate,
  normalizeAssistantMemoryText,
  normalizeDreamMemoryDocument,
  overflowRangeForFold,
  overflowSummaryTextBudget,
  planDreamMemoryRetention,
  replaceDreamMemoryEntryBody,
  resolveMemoryDreamMaxEntries,
  serializeDreamMemoryPriorForPrompt,
  visibleDreamMemoryBody,
  wrapOverflowSummaryBody,
} from '@/helpers/assistantMemory';
import { buildSimpleCompletionSampling } from '@/helpers/contextCompaction';
import { logCompactionDebugSafe } from '@/libs/logger/compactionDebug';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { resolveConversationRuntimePayload } from '@/server/services/conversationGeneration/credentials';
import { createConversationRuntimeChatOptions } from '@/server/services/conversationGeneration/runtimeChatOptions';
import {
  consumeProtocolResponse,
  isIncompleteLengthStop,
} from '@/server/services/conversationGeneration/stream';

import { isDreamDue, previousUtcDayWindow, utcDayWindow } from './schedule';

export interface AssistantMemoryDreamExecuteInput {
  agentId: string;
  db: LobeChatDatabase;
  historyDate?: string;
  match?: string;
  mode?: 'regenerate' | 'scheduled';
  now?: Date;
  periodStamp?: string;
  replaceIndex?: number;
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
    trigger?: 'manual' | 'scheduled';
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
    trigger: fields.trigger ?? 'scheduled',
  });
};

const writeAgentMemoryIfUnchanged = async (
  db: LobeChatDatabase,
  agentId: string,
  userId: string,
  snapshot: AgentDreamSnapshot,
  patch: { assistantMemory?: string; assistantMemoryMeta?: AssistantMemoryMeta },
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
  historyDate,
  model,
  prior,
  provider,
  topics,
  userId,
}: {
  db: LobeChatDatabase;
  fixed: string;
  historyDate: string;
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
      historyDate,
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

const runOverflowFoldCompletion = async ({
  db,
  existingOverflow,
  foldedCards,
  maxChars,
  model,
  previousTooLong,
  provider,
  rangeEnd,
  rangeStart,
  userId,
}: {
  db: LobeChatDatabase;
  existingOverflow?: string;
  foldedCards: Array<{ body: string; dateTag: string }>;
  maxChars: number;
  model: string;
  previousTooLong?: string;
  provider: string;
  rangeEnd: string;
  rangeStart: string;
  userId: string;
}) => {
  const runtimePayload = await resolveConversationRuntimePayload({ db, provider, userId });
  const runtime = initModelRuntimeWithUserPayload(provider, runtimePayload);
  const sampling = buildSimpleCompletionSampling({
    model,
    provider,
    summaryMaxTokens: ASSISTANT_MEMORY_OVERFLOW_MAX_OUTPUT_TOKENS,
  });
  const payload = {
    ...chainAssistantMemoryOverflowFold({
      existingOverflow,
      foldedCards,
      maxChars,
      previousTooLong,
      rangeEnd,
      rangeStart,
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
  return {
    content: result.content.trim(),
    truncated: isIncompleteLengthStop(result.stopReason),
  };
};

export const executeAssistantMemoryDream = async ({
  agentId,
  db,
  historyDate: historyDateInput,
  match,
  mode = 'scheduled',
  now: nowInput,
  periodStamp,
  replaceIndex,
  userId,
}: AssistantMemoryDreamExecuteInput): Promise<AssistantMemoryDreamExecuteResult> => {
  const now = nowInput ?? new Date();
  const isRegenerate = mode === 'regenerate';
  const trigger = isRegenerate ? 'manual' : 'scheduled';

  const scheduledWindow = previousUtcDayWindow(now);
  const historyDate = isRegenerate
    ? (historyDateInput ?? '')
  : scheduledWindow.from.toISOString().slice(0, 10);

  const activityWindow = isRegenerate ? utcDayWindow(historyDate) : scheduledWindow;
  const windowStart = activityWindow.from.toISOString().slice(0, 10);
  const windowEnd = activityWindow.to.toISOString().slice(0, 10);

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
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
    return result;
  }

  const chatConfig = (agent.chatConfig ?? {}) as LobeAgentChatConfig;
  const meta = (agent.assistantMemoryMeta ?? {}) as AssistantMemoryMeta;
  const snapshot: AgentDreamSnapshot = {
    assistantMemory: agent.assistantMemory,
    assistantMemoryMeta: meta,
    updatedAt: agent.updatedAt,
  };
  const maxEntries = resolveMemoryDreamMaxEntries(chatConfig);
  const priorDoc = normalizeDreamMemoryDocument(agent.assistantMemory);

  if (!isRegenerate) {
    const due = isDreamDue({ assistantMemoryMeta: meta, chatConfig, now });

    if (!due.due) {
      const result = { reason: due.skippedReason, status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }

    if (periodStamp && due.periodStamp !== periodStamp) {
      const result = { reason: 'stale_job', status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
  } else {
    if (!historyDate || replaceIndex === undefined || !match) {
      const result = { reason: 'invalid_regenerate', status: 'failed' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
  }

  const topicModel = new TopicModel(db, userId);
  const activeTopicCount = await topicModel.countTopicsForAssistantMemoryDream({
    activityFrom: activityWindow.from,
    activityTo: activityWindow.to,
    agentId,
  });
  const topics = await topicModel.listTopicsForAssistantMemoryDream({
    activityFrom: activityWindow.from,
    activityTo: activityWindow.to,
    agentId,
    limit: ASSISTANT_MEMORY_DREAM_MAX_TOPICS,
  });

  const writeMarker = async (extra: Partial<AssistantMemoryMeta> = {}) => {
    const wrote = await writeAgentMemoryIfUnchanged(db, agentId, userId, snapshot, {
      assistantMemoryMeta: {
        ...snapshot.assistantMemoryMeta,
        lastDreamAt: nowISO(),
        lastDreamMarker: isRegenerate ? snapshot.assistantMemoryMeta.lastDreamMarker : periodStamp,
        lastDreamStatus: 'completed',
        lastError: null,
        lastRollupAt: nowISO(),
        ...extra,
      },
    });
    return wrote;
  };

  if (!isRegenerate && hasDreamMemoryEntryForDate(priorDoc, historyDate)) {
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
    const result = { reason: 'already_has_card', status: 'skipped' as const };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
    return result;
  }

  if (!isRegenerate && activeTopicCount === 0) {
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
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
      trigger,
    });
    return result;
  }

  if (topics.length === 0) {
    if (isRegenerate) {
      const result = {
        activeTopicCount,
        reason: 'no_summaries',
        status: 'skipped' as const,
        topicsWithSummary: 0,
      };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'no_summaries',
      status: 'skipped' as const,
      topicsWithSummary: 0,
    };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
    return result;
  }

  const fixed = (agent.fixedMemory ?? '').trim();
  const { model, provider } = await loadHistoryCompress(db, userId);

  let text = '';
  let failureMessage: string | undefined;
  try {
    text = await runDreamCompletion({
      db,
      fixed,
      historyDate,
      model,
      prior: serializeDreamMemoryPriorForPrompt(priorDoc),
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
    if (isRegenerate) {
      const result = {
        activeTopicCount,
        reason: 'no_changes',
        status: 'skipped' as const,
        topicsWithSummary: topics.length,
      };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
    if (!(await writeMarker())) {
      const result = { reason: 'stale_conflict', status: 'skipped' as const };
      settle({
        ...result,
        activityWindowEnd: windowEnd,
        activityWindowStart: windowStart,
        topicsWithSummary: topics.length,
        trigger,
      });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'no_changes',
      status: 'skipped' as const,
      topicsWithSummary: topics.length,
    };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
    return result;
  }

  const nextBody = failureMessage
    ? ''
    : await capAssistantMemoryByTokensAsync(normalizeAssistantMemoryText(text));

  if (!nextBody) {
    if (isRegenerate) {
      const result = {
        activeTopicCount,
        reason: 'completion_failed',
        status: 'failed' as const,
        topicsWithSummary: topics.length,
      };
      settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
      return result;
    }
    const wrote = await writeAgentMemoryIfUnchanged(db, agentId, userId, snapshot, {
      assistantMemoryMeta: {
        ...snapshot.assistantMemoryMeta,
        lastDreamAt: nowISO(),
        lastDreamStatus: 'failed',
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
        trigger,
      });
      return result;
    }
    const result = {
      activeTopicCount,
      reason: 'completion_failed',
      status: 'failed' as const,
      topicsWithSummary: topics.length,
    };
    settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
    return result;
  }

  const finalizeDreamDocument = (doc: string) =>
    capDreamMemoryDocument(enforceDreamMemoryRetention(doc, maxEntries), maxEntries);

  const applyScheduledFold = async (appendedDoc: string): Promise<string> => {
    const plan = planDreamMemoryRetention(appendedDoc, maxEntries);
    const range = overflowRangeForFold(plan);
    if (plan.fold.length === 0 || !range) return finalizeDreamDocument(appendedDoc);

    try {
      const maxChars = overflowSummaryTextBudget(range.start, range.end);
      const foldArgs = {
        db,
        existingOverflow: plan.overflow.map((entry) => visibleDreamMemoryBody(entry)).join('\n\n'),
        foldedCards: plan.fold.map((entry) => ({ body: entry.body, dateTag: entry.dateTag })),
        maxChars,
        model,
        provider,
        rangeEnd: range.end,
        rangeStart: range.start,
        userId,
      };
      const wrapSummary = (raw: string, truncated: boolean) => {
        const normalized = normalizeAssistantMemoryText(raw, Number.POSITIVE_INFINITY);
        if (!normalized || normalized === ASSISTANT_MEMORY_NO_CHANGES_SENTINEL) {
          return { normalized, truncated, wrapped: '' };
        }
        return {
          normalized,
          truncated,
          wrapped: wrapOverflowSummaryBody(normalized, range.start, range.end),
        };
      };

      const foldOnce = async (previousTooLong?: string) => {
        const { content, truncated } = await runOverflowFoldCompletion({
          ...foldArgs,
          previousTooLong,
        });
        return wrapSummary(content, truncated);
      };

      let attempt = await foldOnce();
      const needsRewrite =
        !!attempt.normalized &&
        attempt.normalized !== ASSISTANT_MEMORY_NO_CHANGES_SENTINEL &&
        (attempt.truncated || attempt.wrapped.length > ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
      if (needsRewrite) {
        attempt = await foldOnce(attempt.normalized);
      }
      if (
        !attempt.normalized ||
        attempt.normalized === ASSISTANT_MEMORY_NO_CHANGES_SENTINEL ||
        attempt.truncated ||
        attempt.wrapped.length > ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS
      ) {
        return finalizeDreamDocument(appendedDoc);
      }
      const { wrapped } = attempt;
      return assembleDreamMemoryAfterFold(
        plan,
        {
          body: wrapped,
          dateTag: `${range.start}..${range.end}`,
          index: 1,
          regenerable: false,
        },
        maxEntries,
      );
    } catch {
      return finalizeDreamDocument(appendedDoc);
    }
  };

  let nextDoc: string;
  if (isRegenerate) {
    const replaced = replaceDreamMemoryEntryBody(
      priorDoc,
      replaceIndex!,
      historyDate,
      match!,
      nextBody,
    );
    if ('error' in replaced) {
      const result = { reason: replaced.error, status: 'failed' as const };
      settle({
        ...result,
        activityWindowEnd: windowEnd,
        activityWindowStart: windowStart,
        topicsWithSummary: topics.length,
        trigger,
      });
      return result;
    }
    nextDoc = finalizeDreamDocument(replaced.doc);
  } else {
    const appended = appendDreamMemoryEntry(priorDoc, historyDate, nextBody);
    nextDoc = await applyScheduledFold(appended.doc);
  }

  const wrote = await writeAgentMemoryIfUnchanged(db, agentId, userId, snapshot, {
    assistantMemory: nextDoc,
    assistantMemoryMeta: isRegenerate
      ? snapshot.assistantMemoryMeta
      : {
          ...snapshot.assistantMemoryMeta,
          lastDreamAt: nowISO(),
          lastDreamMarker: periodStamp,
          lastDreamStatus: 'completed',
          lastError: null,
          lastRollupAt: nowISO(),
          previousMemory: priorDoc
            ? { at: nowISO(), text: priorDoc }
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
      trigger,
    });
    return result;
  }

  const result = {
    activeTopicCount,
    status: 'success' as const,
    topicsWithSummary: topics.length,
  };
  settle({ ...result, activityWindowEnd: windowEnd, activityWindowStart: windowStart, trigger });
  return result;
};
