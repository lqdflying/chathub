import { z } from 'zod';

import { RAG_CHAT_RESULT_LIMIT } from './rag';

export type ContextExportJsonValue =
  | boolean
  | null
  | number
  | string
  | ContextExportJsonValue[]
  | { [key: string]: ContextExportJsonValue };

export type ContextExportPurpose = 'assistant' | 'member' | 'supervisor';

export type ContextExportContinuationReason = 'initial' | 'tool';

export type ContextExportRequestStatus = 'capturing' | 'complete' | 'error' | 'partial';

export const KnowledgeBasePromptTokenCountModeSchema = z.enum(['exact', 'estimated', 'character']);

export type KnowledgeBasePromptTokenCountMode = z.infer<
  typeof KnowledgeBasePromptTokenCountModeSchema
>;

export interface ContextExportAllocation {
  assistantMemory?: number;
  chatInstruction?: number;
  chatMessages?: number;
  groupOrchestration?: number;
  historySummary?: number;
  knowledgeBase?: number;
  pluginSettings?: number;
  roleSettings?: number;
  supervisor?: number;
  total: number;
}

export interface ContextExportKnowledgeBaseSummary {
  countMode?: KnowledgeBasePromptTokenCountMode;
  diagnosticId?: string;
  promptTokens: number;
  queryRewritten: boolean;
  retrieval: {
    candidateCount: number;
    candidateLimit: number;
    eligibleCount: number;
    minimumSimilarity: number;
    resultLimit: number;
    selectedCount: number;
    selectedScores: number[];
    strategy: 'cosine';
  };
  scope: {
    directFileCount: number;
    expandedFileCount: number;
    knowledgeBaseCount: number;
  };
}

export interface ContextExportRequestMetadata {
  apiMode?: 'chatCompletion' | 'generateContent' | 'generateObject' | 'messages' | 'responses';
  model: string;
  provider: string;
  runtime?: string;
}

export interface ContextExportRequestSnapshot {
  allocation?: ContextExportAllocation;
  captureId: string;
  continuationReason: ContextExportContinuationReason;
  engineeredInput?: ContextExportJsonValue;
  error?: string;
  knowledgeBase?: ContextExportKnowledgeBaseSummary;
  metadata?: ContextExportRequestMetadata;
  providerRequest?: ContextExportJsonValue;
  purpose: ContextExportPurpose;
  redactions: string[];
  requestId: string;
  sequence: number;
  status: ContextExportRequestStatus;
}

export interface ContextExportBatch {
  captureId: string;
  completedAt?: number;
  createdAt: number;
  requests: ContextExportRequestSnapshot[];
  status: ContextExportRequestStatus;
}

export interface ContextExportRequestContext {
  allocation?: ContextExportAllocation;
  captureId: string;
  continuationReason: ContextExportContinuationReason;
  knowledgeBase?: ContextExportKnowledgeBaseSummary;
  purpose: ContextExportPurpose;
  requestId: string;
  sequence: number;
}

export const ContextExportRequestContextSchema = z.object({
  allocation: z
    .object({
      assistantMemory: z.number().nonnegative().optional(),
      chatInstruction: z.number().nonnegative().optional(),
      chatMessages: z.number().nonnegative().optional(),
      groupOrchestration: z.number().nonnegative().optional(),
      historySummary: z.number().nonnegative().optional(),
      knowledgeBase: z.number().nonnegative().optional(),
      pluginSettings: z.number().nonnegative().optional(),
      roleSettings: z.number().nonnegative().optional(),
      supervisor: z.number().nonnegative().optional(),
      total: z.number().nonnegative(),
    })
    .optional(),
  captureId: z.string().min(1).max(128),
  continuationReason: z.enum(['initial', 'tool']),
  knowledgeBase: z
    .object({
      countMode: KnowledgeBasePromptTokenCountModeSchema.optional(),
      diagnosticId: z.string().min(1).max(64).optional(),
      promptTokens: z.number().int().nonnegative(),
      queryRewritten: z.boolean(),
      retrieval: z.object({
        candidateCount: z.number().int().nonnegative(),
        candidateLimit: z.number().int().nonnegative(),
        eligibleCount: z.number().int().nonnegative(),
        minimumSimilarity: z.number().min(-1).max(1),
        resultLimit: z.number().int().nonnegative(),
        selectedCount: z.number().int().nonnegative(),
        selectedScores: z.array(z.number().min(-1).max(1)).max(RAG_CHAT_RESULT_LIMIT),
        strategy: z.literal('cosine'),
      }),
      scope: z.object({
        directFileCount: z.number().int().nonnegative(),
        expandedFileCount: z.number().int().nonnegative(),
        knowledgeBaseCount: z.number().int().nonnegative(),
      }),
    })
    .optional(),
  purpose: z.enum(['assistant', 'member', 'supervisor']),
  requestId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
});
