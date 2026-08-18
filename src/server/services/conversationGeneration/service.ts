import { LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import {
  ConversationGenerationEnqueueInput,
  ConversationGenerationEnqueueSchema,
  buildConversationGenerationLane,
  isActiveConversationGenerationStatus,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { makeWorkerUtils } from 'graphile-worker';

import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';
import { withConversationWriteLockOrThrow } from '@/server/services/conversationWriteLock';

import {
  CONVERSATION_GENERATION_EVENT_PAGE_SIZE,
  CONVERSATION_GENERATION_MAX_ATTEMPTS,
  CONVERSATION_GENERATION_STALE_PROCESSING_MS,
  CONVERSATION_GENERATION_TASK,
} from './constants';
import { resolveConversationRuntimePayload } from './credentials';
import { findUnsupportedConversationTool } from './tools';

let workerUtilsPromise: Promise<Awaited<ReturnType<typeof makeWorkerUtils>>> | undefined;

const getWorkerUtils = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for conversation generation');
  }
  workerUtilsPromise ??= (async () => {
    const utils = await makeWorkerUtils({ connectionString: process.env.DATABASE_URL });
    await utils.migrate();
    return utils;
  })();
  return workerUtilsPromise;
};

interface EnqueueGraphileJobOptions {
  jobKey?: string;
}

const readGraphileJobId = (result: unknown, fallback: string) => {
  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: Array<{ workerJobId?: string }> } | undefined)?.rows;
  return rows?.[0]?.workerJobId ? String(rows[0].workerJobId) : fallback;
};

const enqueueGraphileJobInDatabase = async (
  database: LobeChatDatabase | Transaction,
  payload: { operationId: string; userId: string },
  options: EnqueueGraphileJobOptions = {},
) => {
  const jobKey = options.jobKey ?? payload.operationId;
  const result = await database.execute(sql`
    SELECT (graphile_worker.add_job(
      ${CONVERSATION_GENERATION_TASK},
      ${JSON.stringify(payload)}::json,
      job_key := ${jobKey},
      max_attempts := ${CONVERSATION_GENERATION_MAX_ATTEMPTS}
    )).id::text AS "workerJobId"
  `);
  return readGraphileJobId(result, jobKey);
};

const enqueueGraphileJobWithRecovery = async (
  database: LobeChatDatabase,
  payload: { operationId: string; userId: string },
  options: EnqueueGraphileJobOptions = {},
) => {
  const jobKey = options.jobKey ?? payload.operationId;
  try {
    return await enqueueGraphileJobInDatabase(database, payload, options);
  } catch (enqueueError) {
    try {
      const utils = await getWorkerUtils();
      const job = await utils.addJob(CONVERSATION_GENERATION_TASK, payload, {
        jobKey,
        maxAttempts: CONVERSATION_GENERATION_MAX_ATTEMPTS,
      });
      return String(job.id);
    } catch (fallbackError) {
      console.warn('[conversation-generation] failed to enqueue Graphile job', {
        enqueueError: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        operationId: payload.operationId,
      });
      return undefined;
    }
  }
};

export class ConversationGenerationService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {}

  enqueue = async (input: ConversationGenerationEnqueueInput) => {
    const parsed = ConversationGenerationEnqueueSchema.parse(input);
    const unsupportedTool = await findUnsupportedConversationTool({
      config: parsed.config,
      db: this.db,
      userId: this.userId,
    });
    if (unsupportedTool) {
      throw new TRPCError({
        code: 'UNPROCESSABLE_CONTENT',
        message: `Durable generation deferred to the browser for "${unsupportedTool.identifier}": ${unsupportedTool.reason}`,
      });
    }
    await resolveConversationRuntimePayload({
      db: this.db,
      fetchOnClient: parsed.config.fetchOnClient,
      provider: parsed.config.provider,
      userId: this.userId,
    });

    return withConversationWriteLockOrThrow(
      this.db,
      this.userId,
      async (transaction) => this.enqueueInTransaction(transaction, parsed),
      parsed.expectedConversationVersion,
    );
  };

  enqueueInTransaction = async (
    transaction: LobeChatDatabase | Transaction,
    input: ConversationGenerationEnqueueInput,
  ) => {
    const parsed = ConversationGenerationEnqueueSchema.parse(input);
    const lane = buildConversationGenerationLane({
      agentId: parsed.agentId,
      groupId: parsed.groupId,
      kind: parsed.kind,
      sessionId: parsed.sessionId,
      targetId: parsed.config.targetId,
      threadId: parsed.threadId,
      topicId: parsed.topicId,
      userId: this.userId,
    });
    const model = new ConversationGenerationModel(transaction, this.userId);
    if (parsed.idempotencyKey) {
      const existing = await model.findByIdempotencyKey(parsed.idempotencyKey);
      if (existing) {
        if (
          existing.kind !== parsed.kind ||
          existing.lane !== lane ||
          existing.config.model !== parsed.config.model ||
          existing.config.provider !== parsed.config.provider
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Generation idempotency key was already used for another request.',
          });
        }
        return existing;
      }
    }

    const messageModel = new MessageModel(transaction, this.userId);
    const active = await model.findActiveByLane(lane);
    if (active && !parsed.replaceActive) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A generation is already running for this conversation.',
      });
    }
    if (active && parsed.replaceActive) {
      await model.requestCancel(active.id);
    }

    const laneGeneration = (await model.findMaxLaneGeneration(lane)) + 1;

    let assistantMessageId = parsed.assistantMessageId;
    if (
      ['chat', 'regenerate', 'continue', 'group_agent'].includes(parsed.kind) &&
      !assistantMessageId
    ) {
      const created = await messageModel.create({
        content: LOADING_FLAT,
        fromModel: parsed.config.model,
        fromProvider: parsed.config.provider,
        groupId: parsed.groupId,
        parentId: parsed.parentMessageId || parsed.userMessageId,
        role: 'assistant',
        sessionId: parsed.sessionId ?? parsed.groupId ?? '',
        threadId: parsed.threadId,
        topicId: parsed.topicId,
      });
      assistantMessageId = created.id;
    }

    const operation = await model.create({
      agentId: parsed.agentId,
      assistantMessageId,
      config: parsed.config,
      conversationVersion: parsed.conversationVersion ?? parsed.expectedConversationVersion,
      groupId: parsed.groupId,
      idempotencyKey: parsed.idempotencyKey,
      kind: parsed.kind,
      lane,
      laneGeneration,
      parentMessageId: parsed.parentMessageId,
      sessionId: parsed.sessionId,
      threadId: parsed.threadId,
      topicId: parsed.topicId,
      userMessageId: parsed.userMessageId,
    });

    const workerJobId = await enqueueGraphileJobInDatabase(transaction, {
      operationId: operation.id,
      userId: this.userId,
    });
    const queued = await model.update(operation.id, { workerJobId });
    if (!queued) throw new Error('Conversation generation could not record its worker job.');

    return { ...queued, assistantMessageId, workerJobId };
  };

  cancel = async (operationId: string) => {
    const model = new ConversationGenerationModel(this.db, this.userId);
    const current = await model.findById(operationId);
    if (!current) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation operation was not found.' });
    }
    if (!isActiveConversationGenerationStatus(current.status)) return current;

    const operation = await model.requestCancel(operationId);
    if (!operation) {
      return (await model.findById(operationId)) || current;
    }

    if (current.status === 'pending') {
      const cancelled = await model.finalizeActive(operationId, 'cancelled', undefined, {
        attempt: current.attempt,
        laneGeneration: current.laneGeneration,
      });
      if (!cancelled) return (await model.findById(operationId)) || operation;
      await model.insertEvent({
        operationId,
        payload: { status: 'cancelled' },
        revision: cancelled.revision,
        type: 'done',
      });
      return cancelled;
    }

    const revision = await model.bumpRevision(operationId);
    await model.insertEvent({
      operationId,
      payload: { status: revision?.status || 'cancelling' },
      revision: revision?.revision ?? operation.revision + 1,
      type: 'status',
    });
    return revision || operation;
  };

  getOperation = async (operationId: string) => {
    const operation = await new ConversationGenerationModel(this.db, this.userId).findById(
      operationId,
    );
    if (!operation) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation operation was not found.' });
    }
    return operation;
  };

  getOperationByIdempotencyKey = async (idempotencyKey: string) => {
    return new ConversationGenerationModel(this.db, this.userId).findByIdempotencyKey(
      idempotencyKey,
    );
  };

  listActive = async () => {
    return new ConversationGenerationModel(this.db, this.userId).listActiveByUser();
  };

  listEvents = async (cursor = 0) => {
    const model = new ConversationGenerationModel(this.db, this.userId);
    const latest = await model.latestEventId();
    if (cursor > latest) {
      return { cursor: 0, events: [], reset: true };
    }
    const events = await model.listEventsAfter(cursor, CONVERSATION_GENERATION_EVENT_PAGE_SIZE);
    return {
      cursor: events.at(-1)?.id ?? cursor,
      events,
      reset: false,
    };
  };
}

export const sweepPendingConversationGenerationJobs = async (db: LobeChatDatabase) => {
  const pending = await new ConversationGenerationModel(db, 'system').listPendingWithoutJob();
  for (const operation of pending) {
    const workerJobId = await enqueueGraphileJobWithRecovery(db, {
      operationId: operation.id,
      userId: operation.userId,
    });
    if (workerJobId) {
      await new ConversationGenerationModel(db, operation.userId).update(operation.id, {
        workerJobId,
      });
    }
  }
};

export const sweepStaleConversationGenerationOperations = async (db: LobeChatDatabase) => {
  const heartbeatBefore = new Date(Date.now() - CONVERSATION_GENERATION_STALE_PROCESSING_MS);
  const systemModel = new ConversationGenerationModel(db, 'system');
  const staleProcessing = await systemModel.listStaleProcessing(heartbeatBefore);

  for (const operation of staleProcessing) {
    const model = new ConversationGenerationModel(db, operation.userId);
    if (operation.attempt >= CONVERSATION_GENERATION_MAX_ATTEMPTS) {
      const error = {
        message: 'Generation stopped responding on its final retry attempt.',
        type: 'StaleProcessing',
      };
      const failed = await model.finalizeActive(operation.id, 'failed', error, {
        attempt: operation.attempt,
        laneGeneration: operation.laneGeneration,
      });
      if (failed) {
        await model.insertEvent({
          operationId: operation.id,
          payload: { error, status: 'failed' },
          revision: failed.revision,
          type: 'error',
        });
      }
      continue;
    }

    const error = {
      message: 'Generation stopped responding and was queued for retry.',
      type: 'StaleProcessing',
    };
    const pending = await model.requeueStaleProcessing(operation.id, heartbeatBefore, error);
    if (!pending) continue;

    await model.insertEvent({
      operationId: operation.id,
      payload: {
        error,
        status: 'pending',
      },
      revision: pending.revision,
      type: 'status',
    });

    const workerJobId = await enqueueGraphileJobWithRecovery(
      db,
      {
        operationId: operation.id,
        userId: operation.userId,
      },
      { jobKey: `${operation.id}:recovery:${pending.revision}` },
    );
    if (workerJobId) {
      await model.update(operation.id, { workerJobId });
    }
  }

  const staleCancelling = await systemModel.listStaleCancelling(heartbeatBefore);
  for (const operation of staleCancelling) {
    const model = new ConversationGenerationModel(db, operation.userId);
    const cancelled = await model.finalizeActive(operation.id, 'cancelled', undefined, {
      attempt: operation.attempt,
      laneGeneration: operation.laneGeneration,
    });
    if (!cancelled) continue;

    await model.insertEvent({
      operationId: operation.id,
      payload: { status: 'cancelled' },
      revision: cancelled.revision,
      type: 'done',
    });
  }
};

export const enqueueConversationGenerationJob = enqueueGraphileJobWithRecovery;

export const isActiveOperation = isActiveConversationGenerationStatus;
