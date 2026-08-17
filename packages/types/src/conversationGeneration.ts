import { z } from 'zod';

import type { LobeAgentChatConfig } from './agent';
import type { ChatMessageError } from './message';

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
export interface ConversationGenerationConfigSnapshot {
  activatedSkillIds?: string[];
  agentId?: string;
  agentParams?: Record<string, unknown>;
  chatConfig?: Partial<LobeAgentChatConfig>;
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
  systemRole?: string;
  targetId?: string;
  title?: { topicId: string };
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
  revision: number;
  sessionId?: string | null;
  startedAt?: Date | string | null;
  status: ConversationGenerationStatus;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
  userMessageId?: string | null;
  workerJobId?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
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
  | ConversationGenerationEvent
  | ConversationGenerationResetEvent;

export interface ConversationGenerationEnqueueInput {
  agentId?: string;
  assistantMessageId?: string;
  config: ConversationGenerationConfigSnapshot;
  conversationVersion?: number;
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
  title: z.object({ topicId: z.string() }).optional(),
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

export const buildConversationGenerationLane = (params: {
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
}) => {
  if (params.groupId) {
    return `${params.userId}:group:${params.groupId}:${params.topicId ?? 'none'}:${params.threadId ?? 'main'}`;
  }

  return `${params.userId}:session:${params.sessionId ?? 'inbox'}:${params.topicId ?? 'none'}:${params.threadId ?? 'main'}`;
};

export const isActiveConversationGenerationStatus = (
  status: ConversationGenerationStatus | string,
) => ConversationGenerationActiveStatuses.includes(status as (typeof ConversationGenerationActiveStatuses)[number]);
