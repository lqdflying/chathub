import {
  buildConversationGenerationLane,
  ConversationGenerationEnqueueInput,
  ConversationGenerationEnqueueSchema,
  isActiveConversationGenerationStatus,
} from '@lobechat/types';
import { LOADING_FLAT } from '@lobechat/const';
import { sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import { makeWorkerUtils } from 'graphile-worker';

import { MessageModel } from '@/database/models/message';
import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { withConversationWriteLockOrThrow } from '@/server/services/conversationWriteLock';

import {
  CONVERSATION_GENERATION_EVENT_PAGE_SIZE,
  CONVERSATION_GENERATION_STALE_PROCESSING_MS,
  CONVERSATION_GENERATION_TASK,
} from './constants';
import { resolveConversationRuntimePayload } from './credentials';

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

const enqueueGraphileJob = async (
  database: LobeChatDatabase | Transaction,
  payload: { operationId: string; userId: string },
) => {
  try {
    await database.execute(sql`
      SELECT graphile_worker.add_job(
        ${CONVERSATION_GENERATION_TASK},
        ${JSON.stringify(payload)}::json,
        job_key := ${payload.operationId},
        max_attempts := 8
      )
    `);
    return payload.operationId;
  } catch {
    try {
      const utils = await getWorkerUtils();
      const job = await utils.addJob(CONVERSATION_GENERATION_TASK, payload, {
        jobKey: payload.operationId,
        maxAttempts: 8,
      });
      return String(job.id);
    } catch (fallbackError) {
      console.warn('[conversation-generation] failed to enqueue Graphile job', {
        operationId: payload.operationId,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
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
    await resolveConversationRuntimePayload({
      db: this.db,
      fetchOnClient: parsed.config.fetchOnClient,
      provider: parsed.config.provider,
      userId: this.userId,
    });

    if (parsed.idempotencyKey) {
      const existing = await new ConversationGenerationModel(this.db, this.userId).findByIdempotencyKey(
        parsed.idempotencyKey,
      );
      if (existing) return existing;
    }

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
      groupId: parsed.groupId,
      sessionId: parsed.sessionId,
      threadId: parsed.threadId,
      topicId: parsed.topicId,
      userId: this.userId,
    });
    const model = new ConversationGenerationModel(transaction, this.userId);
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

    const laneGeneration =
      active && parsed.replaceActive
        ? (active.laneGeneration ?? 1) + 1
        : (await model.findMaxLaneGeneration(lane)) + 1;

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

    const workerJobId = await enqueueGraphileJob(transaction, {
      operationId: operation.id,
      userId: this.userId,
    });
    if (workerJobId) {
      await model.update(operation.id, { workerJobId });
    }

    return { ...operation, assistantMessageId, workerJobId };
  };

  cancel = async (operationId: string) => {
    const model = new ConversationGenerationModel(this.db, this.userId);
    const operation = await model.requestCancel(operationId);
    if (!operation) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation operation was not found.' });
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
    const workerJobId = await enqueueGraphileJob(db, {
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
  const stale = await new ConversationGenerationModel(db, 'system').listStaleProcessing(
    heartbeatBefore,
  );

  for (const operation of stale) {
    const model = new ConversationGenerationModel(db, operation.userId);
    const updated = await model.update(operation.id, {
      error: {
        message: 'Generation stopped responding and was marked interrupted.',
        type: 'StaleProcessing',
      },
      finishedAt: new Date(),
      phase: 'finalizing',
      status: 'interrupted',
    });
    const revision = await model.bumpRevision(operation.id);
    await model.insertEvent({
      operationId: operation.id,
      payload: {
        error: updated?.error,
        status: 'interrupted',
      },
      revision: revision?.revision ?? operation.revision + 1,
      type: 'done',
    });
  }
};

export const enqueueConversationGenerationJob = enqueueGraphileJob;

export const isActiveOperation = isActiveConversationGenerationStatus;
