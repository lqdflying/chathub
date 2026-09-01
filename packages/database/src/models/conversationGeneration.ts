import {
  ConversationGenerationConfigSnapshot,
  ConversationGenerationError,
  ConversationGenerationEventType,
  ConversationGenerationKind,
  ConversationGenerationPhase,
  ConversationGenerationStatus,
  isActiveConversationGenerationStatus,
} from '@lobechat/types';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';

import {
  conversationGenerationEvents,
  conversationGenerationOperations,
  conversationGenerationSteps,
} from '../schemas';
import { LobeChatDatabase, Transaction } from '../type';
import { idGenerator } from '../utils/idGenerator';

const ACTIVE_STATUSES: ConversationGenerationStatus[] = ['pending', 'processing', 'cancelling'];
const BLOCKING_STATUSES: ConversationGenerationStatus[] = ['pending', 'processing'];
const PROCESSING_STATUS: ConversationGenerationStatus[] = ['processing'];
const TERMINAL_STATUSES: ConversationGenerationStatus[] = [
  'cancelled',
  'failed',
  'interrupted',
  'succeeded',
];

export interface ConversationGenerationCleanupCursor {
  finishedAt: Date;
  id: string;
}

export interface CreateConversationGenerationOperationParams {
  agentId?: string | null;
  assistantMessageId?: string | null;
  config: ConversationGenerationConfigSnapshot;
  conversationVersion?: number | null;
  groupId?: string | null;
  idempotencyKey?: string | null;
  kind: ConversationGenerationKind;
  lane: string;
  laneGeneration?: number;
  parentMessageId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userMessageId?: string | null;
}

export class ConversationGenerationModel {
  private userId: string;
  private db: LobeChatDatabase | Transaction;

  constructor(db: LobeChatDatabase | Transaction, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: CreateConversationGenerationOperationParams, id?: string) => {
    const operationId = id ?? idGenerator('conversationGenerationOperations');
    const [item] = await this.db
      .insert(conversationGenerationOperations)
      .values({
        ...params,
        id: operationId,
        laneGeneration: params.laneGeneration ?? 1,
        status: 'pending',
        userId: this.userId,
      })
      .returning();

    return item;
  };

  findById = async (id: string) => {
    return this.db.query.conversationGenerationOperations.findFirst({
      where: and(
        eq(conversationGenerationOperations.id, id),
        eq(conversationGenerationOperations.userId, this.userId),
      ),
    });
  };

  findByIdempotencyKey = async (idempotencyKey: string) => {
    return this.db.query.conversationGenerationOperations.findFirst({
      where: and(
        eq(conversationGenerationOperations.userId, this.userId),
        eq(conversationGenerationOperations.idempotencyKey, idempotencyKey),
      ),
    });
  };

  /**
   * Retire an idempotency key on a finished operation so a new enqueue can reuse
   * the original key (unique on userId + idempotencyKey). Used when memory
   * compaction failed/interrupted/cancelled and must be retryable.
   */
  releaseIdempotencyKey = async (id: string, previousKey: string) => {
    const retiredKey = `${previousKey}:retired:${id}`;
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({ idempotencyKey: retiredKey, updatedAt: new Date() })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          eq(conversationGenerationOperations.idempotencyKey, previousKey),
          inArray(conversationGenerationOperations.status, [
            'cancelled',
            'failed',
            'interrupted',
          ]),
        ),
      )
      .returning();

    return item;
  };

  findActiveByLane = async (lane: string) => {
    return this.db.query.conversationGenerationOperations.findFirst({
      orderBy: [
        desc(conversationGenerationOperations.laneGeneration),
        desc(conversationGenerationOperations.createdAt),
      ],
      where: and(
        eq(conversationGenerationOperations.userId, this.userId),
        eq(conversationGenerationOperations.lane, lane),
        inArray(conversationGenerationOperations.status, BLOCKING_STATUSES),
      ),
    });
  };

  listActiveByUser = async () => {
    return this.db.query.conversationGenerationOperations.findMany({
      orderBy: [desc(conversationGenerationOperations.createdAt)],
      where: and(
        eq(conversationGenerationOperations.userId, this.userId),
        inArray(conversationGenerationOperations.status, ACTIVE_STATUSES),
      ),
    });
  };

  findMaxLaneGeneration = async (lane: string) => {
    const [row] = await this.db
      .select({ laneGeneration: max(conversationGenerationOperations.laneGeneration) })
      .from(conversationGenerationOperations)
      .where(
        and(
          eq(conversationGenerationOperations.userId, this.userId),
          eq(conversationGenerationOperations.lane, lane),
        ),
      );

    return row?.laneGeneration ?? 0;
  };

  isSupersededByLaneGeneration = async (params: {
    id: string;
    lane: string;
    laneGeneration: number;
  }) => {
    const newer = await this.db.query.conversationGenerationOperations.findFirst({
      where: and(
        eq(conversationGenerationOperations.userId, this.userId),
        eq(conversationGenerationOperations.lane, params.lane),
        gt(conversationGenerationOperations.laneGeneration, params.laneGeneration),
        inArray(conversationGenerationOperations.status, ['pending', 'processing']),
      ),
    });

    return Boolean(newer && newer.id !== params.id);
  };

  listStaleProcessing = async (heartbeatBefore: Date) => {
    return this.db.query.conversationGenerationOperations.findMany({
      where: and(
        eq(conversationGenerationOperations.status, 'processing'),
        or(
          isNull(conversationGenerationOperations.heartbeatAt),
          lt(conversationGenerationOperations.heartbeatAt, heartbeatBefore),
        ),
      ),
    });
  };

  listStaleCancelling = async (heartbeatBefore: Date) => {
    return this.db.query.conversationGenerationOperations.findMany({
      where: and(
        eq(conversationGenerationOperations.status, 'cancelling'),
        or(
          isNull(conversationGenerationOperations.heartbeatAt),
          lt(conversationGenerationOperations.heartbeatAt, heartbeatBefore),
        ),
      ),
    });
  };

  listUncleanedFinished = async ({
    after,
    limit = 100,
  }: {
    after?: ConversationGenerationCleanupCursor;
    limit?: number;
  } = {}) => {
    const keyset = after
      ? or(
          gt(conversationGenerationOperations.finishedAt, after.finishedAt),
          and(
            eq(conversationGenerationOperations.finishedAt, after.finishedAt),
            gt(conversationGenerationOperations.id, after.id),
          ),
        )
      : undefined;

    return this.db
      .select()
      .from(conversationGenerationOperations)
      .where(
        and(
          isNull(conversationGenerationOperations.placeholdersCleanedAt),
          isNotNull(conversationGenerationOperations.finishedAt),
          inArray(conversationGenerationOperations.status, TERMINAL_STATUSES),
          keyset,
        ),
      )
      .orderBy(
        asc(conversationGenerationOperations.finishedAt),
        asc(conversationGenerationOperations.id),
      )
      .limit(limit)
      .for('update', { skipLocked: true });
  };

  listPendingWithoutJob = async () => {
    return this.db.query.conversationGenerationOperations.findMany({
      where: and(
        eq(conversationGenerationOperations.status, 'pending'),
        isNull(conversationGenerationOperations.workerJobId),
      ),
    });
  };

  claimForProcessing = async (id: string) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        attempt: sql`${conversationGenerationOperations.attempt} + 1`,
        heartbeatAt: new Date(),
        startedAt: sql`coalesce(${conversationGenerationOperations.startedAt}, now())`,
        status: 'processing',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          eq(conversationGenerationOperations.status, 'pending'),
        ),
      )
      .returning();

    return item;
  };

  touchHeartbeat = async (id: string, attempt?: number) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          eq(conversationGenerationOperations.status, 'processing'),
          attempt === undefined ? undefined : eq(conversationGenerationOperations.attempt, attempt),
        ),
      )
      .returning();

    return item;
  };

  markForRetry = async (id: string, error: ConversationGenerationError, attempt: number) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        error,
        heartbeatAt: null,
        phase: 'queued',
        revision: sql`${conversationGenerationOperations.revision} + 1`,
        status: 'pending',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          eq(conversationGenerationOperations.status, 'processing'),
          eq(conversationGenerationOperations.attempt, attempt),
        ),
      )
      .returning();

    return item;
  };

  requeueStaleProcessing = async (
    id: string,
    heartbeatBefore: Date,
    error: ConversationGenerationError,
  ) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        error,
        heartbeatAt: null,
        phase: 'queued',
        revision: sql`${conversationGenerationOperations.revision} + 1`,
        status: 'pending',
        updatedAt: new Date(),
        workerJobId: null,
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          eq(conversationGenerationOperations.status, 'processing'),
          or(
            isNull(conversationGenerationOperations.heartbeatAt),
            lt(conversationGenerationOperations.heartbeatAt, heartbeatBefore),
          ),
        ),
      )
      .returning();

    return item;
  };

  finalizeActive = async (
    id: string,
    status: Extract<
      ConversationGenerationStatus,
      'succeeded' | 'cancelled' | 'failed' | 'interrupted'
    >,
    error?: ConversationGenerationError,
    guard?: { attempt?: number; laneGeneration?: number },
  ) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        error: error ?? null,
        finishedAt: new Date(),
        phase: 'finalizing',
        revision: sql`${conversationGenerationOperations.revision} + 1`,
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          inArray(
            conversationGenerationOperations.status,
            status === 'cancelled' ? ACTIVE_STATUSES : PROCESSING_STATUS,
          ),
          guard?.attempt === undefined
            ? undefined
            : eq(conversationGenerationOperations.attempt, guard.attempt),
          guard?.laneGeneration === undefined
            ? undefined
            : eq(conversationGenerationOperations.laneGeneration, guard.laneGeneration),
        ),
      )
      .returning();

    return item;
  };

  update = async (
    id: string,
    value: Partial<{
      assistantMessageId: string | null;
      attempt: number;
      cancelRequestedAt: Date | null;
      config: ConversationGenerationConfigSnapshot;
      conversationVersion: number | null;
      error: ConversationGenerationError | null;
      finishedAt: Date | null;
      heartbeatAt: Date | null;
      parentMessageId: string | null;
      phase: ConversationGenerationPhase | null;
      revision: number;
      startedAt: Date | null;
      status: ConversationGenerationStatus;
      userMessageId: string | null;
      workerJobId: string | null;
    }>,
    guard?: { attempt?: number; laneGeneration?: number },
  ) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          inArray(conversationGenerationOperations.status, ACTIVE_STATUSES),
          guard?.attempt === undefined
            ? undefined
            : eq(conversationGenerationOperations.attempt, guard.attempt),
          guard?.laneGeneration === undefined
            ? undefined
            : eq(conversationGenerationOperations.laneGeneration, guard.laneGeneration),
        ),
      )
      .returning();

    return item;
  };

  /**
   * Append a supervisor child message id with a single JSONB UPDATE.
   * PostgreSQL takes a row lock for the JSON update and, under READ COMMITTED,
   * re-evaluates the SET expression against the latest row after waiting, so
   * concurrent appends cannot drop a committed sibling id.
   */
  appendSupervisorChildMessageId = async (
    id: string,
    childMessageId: string,
    guard?: { attempt?: number; laneGeneration?: number },
  ) => {
    const childIdsSql = sql`
      CASE
        WHEN jsonb_typeof(${conversationGenerationOperations.config}->'supervisorChildMessageIds') = 'array'
        THEN ${conversationGenerationOperations.config}->'supervisorChildMessageIds'
        ELSE '[]'::jsonb
      END
    `;
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        config: sql`
          CASE
            WHEN jsonb_exists(${childIdsSql}, ${childMessageId})
            THEN ${conversationGenerationOperations.config}
            ELSE jsonb_set(
              ${conversationGenerationOperations.config},
              '{supervisorChildMessageIds}',
              ${childIdsSql} || jsonb_build_array(${childMessageId})
            )
          END
        `,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          inArray(conversationGenerationOperations.status, ACTIVE_STATUSES),
          guard?.attempt === undefined
            ? undefined
            : eq(conversationGenerationOperations.attempt, guard.attempt),
          guard?.laneGeneration === undefined
            ? undefined
            : eq(conversationGenerationOperations.laneGeneration, guard.laneGeneration),
        ),
      )
      .returning();

    return item;
  };

  markPlaceholdersCleaned = async (id: string) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        placeholdersCleanedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          isNull(conversationGenerationOperations.placeholdersCleanedAt),
          isNotNull(conversationGenerationOperations.finishedAt),
          inArray(conversationGenerationOperations.status, TERMINAL_STATUSES),
        ),
      )
      .returning();

    return item;
  };

  bumpRevision = async (id: string, guard?: { attempt?: number; laneGeneration?: number }) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        heartbeatAt: new Date(),
        revision: sql`${conversationGenerationOperations.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          inArray(conversationGenerationOperations.status, ACTIVE_STATUSES),
          guard?.attempt === undefined
            ? undefined
            : eq(conversationGenerationOperations.attempt, guard.attempt),
          guard?.laneGeneration === undefined
            ? undefined
            : eq(conversationGenerationOperations.laneGeneration, guard.laneGeneration),
        ),
      )
      .returning();

    return item;
  };

  requestCancel = async (id: string) => {
    const [item] = await this.db
      .update(conversationGenerationOperations)
      .set({
        cancelRequestedAt: new Date(),
        status: sql`case when ${conversationGenerationOperations.status} in ('pending', 'processing') then 'cancelling' else ${conversationGenerationOperations.status} end`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerationOperations.id, id),
          eq(conversationGenerationOperations.userId, this.userId),
          inArray(conversationGenerationOperations.status, ACTIVE_STATUSES),
        ),
      )
      .returning();

    return item;
  };

  insertEvent = async (params: {
    operationId: string;
    payload?: Record<string, unknown>;
    revision: number;
    type: ConversationGenerationEventType;
  }) => {
    const [item] = await this.db
      .insert(conversationGenerationEvents)
      .values({
        operationId: params.operationId,
        payload: params.payload ?? {},
        revision: params.revision,
        type: params.type,
        userId: this.userId,
      })
      .returning();

    return item;
  };

  listEventsAfter = async (cursor: number, limit = 200) => {
    return this.db
      .select()
      .from(conversationGenerationEvents)
      .where(
        and(
          eq(conversationGenerationEvents.userId, this.userId),
          gt(conversationGenerationEvents.id, cursor),
        ),
      )
      .orderBy(conversationGenerationEvents.id)
      .limit(limit);
  };

  latestEventId = async () => {
    const [row] = await this.db
      .select({ id: conversationGenerationEvents.id })
      .from(conversationGenerationEvents)
      .where(eq(conversationGenerationEvents.userId, this.userId))
      .orderBy(desc(conversationGenerationEvents.id))
      .limit(1);

    return row?.id ?? 0;
  };

  claimStep = async (params: {
    attempt: number;
    inputHash: string;
    kind: string;
    operationId: string;
  }) => {
    const now = new Date();
    const [item] = await this.db
      .insert(conversationGenerationSteps)
      .values({
        attempt: params.attempt,
        id: idGenerator('conversationGenerationSteps'),
        inputHash: params.inputHash,
        kind: params.kind,
        operationId: params.operationId,
        startedAt: now,
        status: 'processing',
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          attempt: params.attempt,
          error: null,
          finishedAt: null,
          result: null,
          startedAt: now,
          status: 'processing',
          updatedAt: now,
        },
        setWhere: sql`${conversationGenerationSteps.status} is distinct from 'succeeded' AND (${conversationGenerationSteps.status} is distinct from 'processing' OR ${conversationGenerationSteps.startedAt} < now() - interval '90 seconds')`,
        target: [conversationGenerationSteps.operationId, conversationGenerationSteps.inputHash],
      })
      .returning();

    if (item) return item;

    return this.findStepByHash(params.operationId, params.inputHash);
  };

  findStepByHash = async (operationId: string, inputHash: string) => {
    return this.db.query.conversationGenerationSteps.findFirst({
      where: and(
        eq(conversationGenerationSteps.operationId, operationId),
        eq(conversationGenerationSteps.userId, this.userId),
        eq(conversationGenerationSteps.inputHash, inputHash),
      ),
    });
  };

  createStep = async (params: {
    attempt?: number;
    inputHash?: string | null;
    kind: string;
    operationId: string;
    result?: Record<string, unknown> | null;
    status: string;
  }) => {
    const [item] = await this.db
      .insert(conversationGenerationSteps)
      .values({
        attempt: params.attempt ?? 0,
        id: idGenerator('conversationGenerationSteps'),
        inputHash: params.inputHash,
        kind: params.kind,
        operationId: params.operationId,
        result: params.result,
        startedAt: new Date(),
        status: params.status,
        userId: this.userId,
      })
      .returning();

    return item;
  };

  findCompletedStepByHash = async (operationId: string, inputHash: string) => {
    return this.db.query.conversationGenerationSteps.findFirst({
      where: and(
        eq(conversationGenerationSteps.operationId, operationId),
        eq(conversationGenerationSteps.userId, this.userId),
        eq(conversationGenerationSteps.inputHash, inputHash),
        eq(conversationGenerationSteps.status, 'succeeded'),
      ),
    });
  };

  updateStep = async (
    id: string,
    value: Partial<{
      error: ConversationGenerationError | null;
      finishedAt: Date | null;
      result: Record<string, unknown> | null;
      status: string;
    }>,
  ) => {
    const [item] = await this.db
      .update(conversationGenerationSteps)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(
          eq(conversationGenerationSteps.id, id),
          eq(conversationGenerationSteps.userId, this.userId),
        ),
      )
      .returning();

    return item;
  };
}

export const isActiveGenerationStatus = isActiveConversationGenerationStatus;
