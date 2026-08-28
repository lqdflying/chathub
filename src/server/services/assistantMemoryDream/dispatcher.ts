import type { LobeChatDatabase } from '@lobechat/database';
import type { AssistantMemoryMeta, LobeAgentChatConfig } from '@lobechat/types';
import { or, sql } from 'drizzle-orm';

import { agents } from '@/database/schemas';
import { hashCompactionDebugValue, logCompactionDebugSafe } from '@/libs/logger/compactionDebug';

import { ASSISTANT_MEMORY_DREAM_MAX_ATTEMPTS, ASSISTANT_MEMORY_DREAM_TASK } from './constants';
import { isDreamDue } from './schedule';

const dreamJobKey = (agentId: string, periodStamp: string) =>
  `assistant-memory-dream:${agentId}:${periodStamp}`;

const enqueueDreamJob = async (
  db: LobeChatDatabase,
  payload: { agentId: string; periodStamp: string; userId: string },
) => {
  const jobKey = dreamJobKey(payload.agentId, payload.periodStamp);
  await db.execute(sql`
    SELECT graphile_worker.add_job(
      ${ASSISTANT_MEMORY_DREAM_TASK},
      ${JSON.stringify(payload)}::json,
      job_key := ${jobKey},
      job_key_mode := 'unsafe_dedupe',
      max_attempts := ${ASSISTANT_MEMORY_DREAM_MAX_ATTEMPTS}
    )
  `);
};

export const dispatchDueAssistantMemoryDreams = async (db: LobeChatDatabase, now = new Date()) => {
  const rows = await db
    .select({
      assistantMemoryMeta: agents.assistantMemoryMeta,
      chatConfig: agents.chatConfig,
      id: agents.id,
      userId: agents.userId,
    })
    .from(agents)
    .where(
      or(
        sql`${agents.chatConfig}->>'memoryDreamScheduleFrequency' in ('daily','weekly')`,
        sql`coalesce(${agents.chatConfig}->>'enableDailyMemorySummary', 'false') = 'true'`,
        sql`coalesce(${agents.chatConfig}->>'enablePeriodicAssistantMemoryRollup', 'false') = 'true'`,
      ),
    );

  for (const row of rows) {
    const chatConfig = (row.chatConfig ?? {}) as LobeAgentChatConfig;
    const assistantMemoryMeta = (row.assistantMemoryMeta ?? null) as AssistantMemoryMeta | null;
    const due = isDreamDue({ assistantMemoryMeta, chatConfig, now });
    const markerKeyHash = hashCompactionDebugValue(dreamJobKey(row.id, due.periodStamp));

    logCompactionDebugSafe('dream_scheduler_tick', {
      due: due.due,
      frequency: due.frequency,
      markerKeyHash,
      path: 'assistant_memory_rollup',
      scheduleTime: due.scheduleTime,
      skippedReason: due.skippedReason,
      trigger: 'scheduled',
    });

    if (!due.due) continue;

    try {
      await enqueueDreamJob(db, {
        agentId: row.id,
        periodStamp: due.periodStamp,
        userId: row.userId,
      });
    } catch {
      logCompactionDebugSafe('dream_scheduler_settled', {
        markerKeyHash,
        path: 'assistant_memory_rollup',
        reason: 'enqueue_failed',
        status: 'failed',
        trigger: 'scheduled',
      });
    }
  }
};
