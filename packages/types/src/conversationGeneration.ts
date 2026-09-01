import { z } from 'zod';

import type { LobeAgentChatConfig } from './agent';
import type { ChatMessageError } from './message';
import type { MemoryCompactionTrigger } from './topic';

export const ConversationGenerationKinds = [
  'chat',
  'regenerate',
  'continue',
  'group_supervisor',
  'group_agent',
  'topic_title',
  'memory_compaction',
  'translation',
  'tts',
  'rag',
] as const;

export type ConversationGenerationKind = (typeof ConversationGenerationKinds)[number];

export const ConversationGenerationStatuses = [
  'pending',
  'processing',
  'cancelling',
  'cancelled',
  'succeeded',
  'failed',
  'interrupted',
] as const;

export type ConversationGenerationStatus = (typeof ConversationGenerationStatuses)[number];

export const ConversationGenerationActiveStatuses = [
  'pending',
  'processing',
  'cancelling',
] as const satisfies readonly ConversationGenerationStatus[];

export const ConversationGenerationPhases = [
  'queued',
  'compacting',
  'retrieving',
  'model',
  'tools',
  'title',
  'translating',
  'synthesizing',
  'finalizing',
] as const;

export type ConversationGenerationPhase = (typeof ConversationGenerationPhases)[number];

export const ConversationGenerationEventTypes = [
  'status',
  'snapshot',
  'delta',
  'error',
  'done',
] as const;

export type ConversationGenerationEventType = (typeof ConversationGenerationEventTypes)[number];

/**
 * Non-secret request snapshot persisted with the operation. Credentials are
 * resolved from encrypted user/provider vaults at execution time.
 */
export interface ConversationGenerationCompactionSnapshot {
  candidateMessageIds: string[];
  /**
   * Client planner span for CHATHUB_COMPACTION_DEBUG / generation-debug join.
   * Diagnostics only; never message content.
   */
  debugSpanId?: string;
  enableUserMemoryArchive?: boolean;
  estimatedTokensBefore?: number;
  expectedCursorId?: string;
  expectedFingerprint: string;
  expectedHistorySummary: string;
  highWatermark?: number;
  lowWatermark?: number;
  /**
   * History Compress `contextWindowTokens` resolved by the planner
   * (`enabledAiModels`, including custom cards). Worker uses this before the
   * built-in model-bank / 128k fallback.
   */
  summarizerContextWindow?: number;
  targetReachable?: boolean;
  trigger: MemoryCompactionTrigger;
}

export interface ConversationGenerationConfigSnapshot {
  activatedSkillIds?: string[];
  agentId?: string;
  agentParams?: Record<string, unknown>;
  chatConfig?: Partial<LobeAgentChatConfig>;
  compaction?: ConversationGenerationCompactionSnapshot;
  enableMemoryTool?: boolean;
  fetchOnClient?: boolean;
  groupId?: string;
  historySummary?: string;
  historySummaryLastMessageId?: string;
  isWelcomeQuestion?: boolean;
  locale?: string;
  model: string;
  plugins?: string[];
  provider: string;
  ragQuery?: string;
  rewindFromMessageId?: string;
  supervisorChildMessageIds?: string[];
  systemRole?: string;
  targetId?: string;
  title?: { force?: boolean; topicId: string };
  translation?: { from?: string; messageId: string; to: string };
  tts?: { messageId: string; voice?: string };
}

export interface ConversationGenerationError {
  body?: unknown;
  message: string;
  type: string;
}

export interface ConversationGenerationOperation {
  agentId?: string | null;
  assistantMessageId?: string | null;
  attempt: number;
  cancelRequestedAt?: Date | string | null;
  config: ConversationGenerationConfigSnapshot;
  conversationVersion?: number | null;
  createdAt?: Date | string;
  error?: ConversationGenerationError | ChatMessageError | null;
  finishedAt?: Date | string | null;
  groupId?: string | null;
  heartbeatAt?: Date | string | null;
  id: string;
  idempotencyKey?: string | null;
  kind: ConversationGenerationKind;
  lane: string;
  laneGeneration: number;
  parentMessageId?: string | null;
  phase?: ConversationGenerationPhase | null;
  placeholdersCleanedAt?: Date | string | null;
  revision: number;
  sessionId?: string | null;
  startedAt?: Date | string | null;
  status: ConversationGenerationStatus;
  threadId?: string | null;
  topicId?: string | null;
  updatedAt?: Date | string;
  userId: string;
  userMessageId?: string | null;
  workerJobId?: string | null;
}

export interface ConversationGenerationEvent {
  createdAt: Date | string;
  id: number;
  operationId: string;
  payload: Record<string, unknown>;
  revision: number;
  type: ConversationGenerationEventType;
  userId: string;
}

export interface ConversationGenerationResetEvent {
  reset: true;
  type: 'reset';
}

export type ConversationGenerationStreamEvent =
  ConversationGenerationEvent | ConversationGenerationResetEvent;

export interface ConversationGenerationEnqueueInput {
  agentId?: string;
  assistantMessageId?: string;
  config: ConversationGenerationConfigSnapshot;
  conversationVersion?: number;
  /**
   * Optional correlation id created by the client for CHATHUB_GENERATION_DEBUG.
   * Diagnostics only: hashed/label-sanitized before logging, never content.
   */
  debugSpanId?: string;
  expectedConversationVersion?: number;
  groupId?: string;
  idempotencyKey?: string;
  kind: ConversationGenerationKind;
  parentMessageId?: string;
  replaceActive?: boolean;
  sessionId?: string;
  threadId?: string;
  topicId?: string;
  userMessageId?: string;
}

export const ConversationGenerationConfigSchema = z.object({
  activatedSkillIds: z.array(z.string()).optional(),
  agentId: z.string().optional(),
  agentParams: z.record(z.string(), z.unknown()).optional(),
  chatConfig: z.record(z.string(), z.unknown()).optional(),
  compaction: z
    .object({
      candidateMessageIds: z.array(z.string()).min(1),
      debugSpanId: z.string().min(4).max(64).optional(),
      enableUserMemoryArchive: z.boolean().optional(),
      estimatedTokensBefore: z.number().optional(),
      expectedCursorId: z.string().optional(),
      expectedFingerprint: z.string().min(1),
      expectedHistorySummary: z.string(),
      highWatermark: z.number().optional(),
      lowWatermark: z.number().optional(),
      summarizerContextWindow: z.number().int().positive().max(16_777_216).optional(),
      targetReachable: z.boolean().optional(),
      trigger: z.enum(['manual', 'message_count', 'scheduled', 'token_threshold']),
    })
    .optional(),
  enableMemoryTool: z.boolean().optional(),
  fetchOnClient: z.boolean().optional(),
  groupId: z.string().optional(),
  historySummary: z.string().optional(),
  historySummaryLastMessageId: z.string().optional(),
  isWelcomeQuestion: z.boolean().optional(),
  locale: z.string().optional(),
  model: z.string().min(1),
  plugins: z.array(z.string()).optional(),
  provider: z.string().min(1),
  ragQuery: z.string().optional(),
  rewindFromMessageId: z.string().optional(),
  systemRole: z.string().optional(),
  targetId: z.string().optional(),
  title: z.object({ force: z.boolean().optional(), topicId: z.string() }).optional(),
  translation: z
    .object({
      from: z.string().optional(),
      messageId: z.string(),
      to: z.string(),
    })
    .optional(),
  tts: z
    .object({
      messageId: z.string(),
      voice: z.string().optional(),
    })
    .optional(),
});

export const ConversationGenerationEnqueueSchema = z.object({
  agentId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  config: ConversationGenerationConfigSchema,
  conversationVersion: z.number().optional(),
  debugSpanId: z.string().min(4).max(64).optional(),
  expectedConversationVersion: z.number().optional(),
  groupId: z.string().optional(),
  idempotencyKey: z.string().min(8).max(180).optional(),
  kind: z.enum(ConversationGenerationKinds),
  parentMessageId: z.string().optional(),
  replaceActive: z.boolean().optional(),
  sessionId: z.string().optional(),
  threadId: z.string().optional(),
  topicId: z.string().optional(),
  userMessageId: z.string().optional(),
});

/**
 * Lanes serialize replaceActive within a family. Chat retries share a lane;
 * title, translation, and compaction must not cancel an in-flight reply.
 */
export const ConversationGenerationLaneFamilies = {
  chat: 'chat',
  continue: 'chat',
  regenerate: 'chat',
  group_supervisor: 'chat',
  group_agent: 'chat',
  topic_title: 'topic_title',
  translation: 'translation',
  memory_compaction: 'memory_compaction',
  tts: 'tts',
  rag: 'rag',
} as const satisfies Record<ConversationGenerationKind, string>;

export const getConversationGenerationLaneFamily = (kind: ConversationGenerationKind = 'chat') =>
  ConversationGenerationLaneFamilies[kind];

export const ConversationGenerationChatFamilyKinds = ConversationGenerationKinds.filter(
  (kind) => ConversationGenerationLaneFamilies[kind] === 'chat',
) as ConversationGenerationKind[];

export const isConversationGenerationChatFamilyKind = (kind: ConversationGenerationKind) =>
  ConversationGenerationLaneFamilies[kind] === 'chat';

export const buildConversationGenerationLane = (params: {
  agentId?: string | null;
  groupId?: string | null;
  kind?: ConversationGenerationKind;
  sessionId?: string | null;
  targetId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
}) => {
  const family = getConversationGenerationLaneFamily(params.kind);
  const scope = params.groupId
    ? `group:${params.groupId}`
    : `session:${params.sessionId ?? 'inbox'}`;
  const base = `${params.userId}:${scope}:${params.topicId ?? 'none'}:${params.threadId ?? 'main'}:${family}`;

  if (params.kind === 'group_supervisor') {
    return `${base}:supervisor`;
  }

  if (params.kind === 'group_agent') {
    return `${base}:agent:${params.agentId || 'unknown'}:${params.targetId || 'default'}`;
  }

  return base;
};

export const isActiveConversationGenerationStatus = (
  status: ConversationGenerationStatus | string,
) =>
  ConversationGenerationActiveStatuses.includes(
    status as (typeof ConversationGenerationActiveStatuses)[number],
  );

/** Terminal statuses that must not block a new memory_compaction enqueue. */
export const ConversationGenerationRetryableTerminalStatuses = [
  'failed',
  'interrupted',
  'cancelled',
] as const satisfies readonly ConversationGenerationStatus[];

export const isRetryableTerminalConversationGenerationStatus = (
  status: ConversationGenerationStatus | string,
) =>
  ConversationGenerationRetryableTerminalStatuses.includes(
    status as (typeof ConversationGenerationRetryableTerminalStatuses)[number],
  );
