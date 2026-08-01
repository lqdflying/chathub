import { z } from 'zod';

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

export interface ContextExportAllocation {
  assistantMemory?: number;
  chatInstruction?: number;
  chatMessages?: number;
  groupOrchestration?: number;
  historySummary?: number;
  pluginSettings?: number;
  roleSettings?: number;
  supervisor?: number;
  total: number;
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
      pluginSettings: z.number().nonnegative().optional(),
      roleSettings: z.number().nonnegative().optional(),
      supervisor: z.number().nonnegative().optional(),
      total: z.number().nonnegative(),
    })
    .optional(),
  captureId: z.string().min(1).max(128),
  continuationReason: z.enum(['initial', 'tool']),
  purpose: z.enum(['assistant', 'member', 'supervisor']),
  requestId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
});

