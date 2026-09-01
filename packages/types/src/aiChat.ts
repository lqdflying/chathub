import { z } from 'zod';

import {
  ConversationGenerationConfigSchema,
  ConversationGenerationConfigSnapshot,
  ConversationGenerationOperation,
  optionalConversationScopeIdSchema,
} from './conversationGeneration';
import { UIChatMessage } from './message';
import { OpenAIChatMessage } from './openai/chat';
import { LobeUniformTool, LobeUniformToolSchema } from './tool';
import { ChatTopic } from './topic';

export interface SendNewMessage {
  content: string;
  // if message has attached with files, then add files to message and the agent
  files?: string[];
  metadata?: Record<string, any>;
}

export interface SendMessageServerParams {
  expectedConversationVersion?: number;
  generation?: {
    config: ConversationGenerationConfigSnapshot;
    debugSpanId?: string;
    idempotencyKey?: string;
  };
  newTopic?: {
    title?: string;
    topicMessageIds?: string[];
  };
  newUserMessage: SendNewMessage;
  sessionId?: string;
  threadId?: string | null;
  // if there is activeTopicId，then add topicId to message
  topicId?: string | null;
}

export const AiSendMessageServerSchema = z.object({
  expectedConversationVersion: z.number().optional(),
  generation: z
    .object({
      config: ConversationGenerationConfigSchema,
      debugSpanId: z.string().min(4).max(64).optional(),
      idempotencyKey: z.string().min(8).max(180).optional(),
    })
    .optional(),
  newTopic: z
    .object({
      title: z.string().optional(),
      topicMessageIds: z.array(z.string()).optional(),
    })
    .optional(),
  newUserMessage: z.object({
    content: z.string(),
    files: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  sessionId: z.string().optional(),
  threadId: optionalConversationScopeIdSchema,
  topicId: optionalConversationScopeIdSchema,
});

export interface CreateAssistantMessageServerParams {
  assistantMessageId: string;
  expectedConversationVersion?: number;
  model: string;
  parentId: string;
  provider: string;
  sessionId?: string;
  threadId?: string | null;
  topicId?: string | null;
}

export const AiCreateAssistantMessageSchema = z.object({
  assistantMessageId: z.string().regex(/^msg_[\dA-Za-z]{14}$/),
  expectedConversationVersion: z.number().optional(),
  model: z.string().min(1),
  parentId: z.string().min(1),
  provider: z.string().min(1),
  sessionId: z.string().optional(),
  threadId: optionalConversationScopeIdSchema,
  topicId: optionalConversationScopeIdSchema,
});

export interface CreateAssistantMessageServerResponse {
  messages: UIChatMessage[];
}

/** Why durable enqueue was skipped so the client can run a browser-fallback lane. */
export type ConversationGenerationDeferReason = 'unsupported_tool' | 'fetch_on_client';

/** Structured enqueue result when the client should run the browser-fallback path. */
export interface ConversationGenerationDeferred {
  deferred: true;
  reason: ConversationGenerationDeferReason;
  toolName?: string;
}

export const isConversationGenerationDeferred = (
  value: unknown,
): value is ConversationGenerationDeferred =>
  Boolean(value && typeof value === 'object' && 'deferred' in value && (value as { deferred?: unknown }).deferred === true);

export interface SendMessageServerResponse {
  /** Reserved server-generated ID. The assistant row is created after pre-send compaction. */
  assistantMessageId: string;
  /**
   * Present when durable enqueue was skipped and the client should own finalization
   * on the browser path (for example a browser-only plugin).
   */
  deferReason?: ConversationGenerationDeferReason;
  /** Plugin identifier when `deferReason` is `unsupported_tool`. */
  deferredToolName?: string;
  isCreateNewTopic: boolean;
  messages: UIChatMessage[];
  /** Present when durable server-side generation was enqueued. */
  operationId?: string;
  /** Operation metadata used to attach the exact durable lane without another request. */
  operation?: ConversationGenerationOperation;
  topicId: string;
  topics?: ChatTopic[];
  userMessageId: string;
}

export const StructureSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  schema: z.object({
    $defs: z.any().optional(),
    additionalProperties: z.boolean().optional(),
    properties: z.record(z.string(), z.any()),
    required: z.array(z.string()).optional(),
    type: z.literal('object'),
  }),
  strict: z.boolean().optional(),
});

export const StructureOutputSchema = z.object({
  keyVaultsPayload: z.string(),
  messages: z.array(z.any()),
  model: z.string(),
  provider: z.string(),
  schema: StructureSchema.optional(),
  tools: z
    .array(z.object({ function: LobeUniformToolSchema, type: z.literal('function') }))
    .optional(),
});

interface IStructureSchema {
  description: string;
  name: string;
  schema: {
    additionalProperties?: boolean;
    properties: Record<string, any>;
    required?: string[];
    type: 'object';
  };
  strict?: boolean;
}

export interface StructureOutputParams {
  keyVaultsPayload: string;
  messages: OpenAIChatMessage[];
  model: string;
  provider: string;
  schema?: IStructureSchema;
  systemRole?: string;
  tools?: {
    function: LobeUniformTool;
    type: 'function';
  }[];
}
