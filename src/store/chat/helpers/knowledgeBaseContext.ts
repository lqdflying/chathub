import {
  ChatErrorType,
  type ChatMessageError,
  type ContextExportAllocation,
  type ContextExportKnowledgeBaseSummary,
  type ContextExportRequestContext,
  type KnowledgeBasePromptTokenCountMode,
  type RagChatRetrievalStats,
  type RagChatScopeStats,
} from '@lobechat/types';

import { MAX_EXACT_TOKENIZER_INPUT_LENGTH, encodeAsync } from '@/utils/tokenizer';
import { estimatedEncodeAsync } from '@/utils/tokenizer/estimated';

export const CONTEXT_EXPORT_REDACTIONS = [
  'credentials',
  'transportHeaders',
  'transportOptions',
  'baseUrls',
  'signalsAndCallbacks',
  'storedIdentifiers',
  'traceAndDiagnostics',
  'cacheRouting',
  'inlineMediaData',
];

export interface KnowledgeBasePromptTokenCount {
  countMode: KnowledgeBasePromptTokenCountMode;
  promptTokens: number;
}

export const countKnowledgeBasePromptTokens = async (
  prompt: string,
): Promise<KnowledgeBasePromptTokenCount> => {
  if (!prompt) return { countMode: 'exact', promptTokens: 0 };

  if (prompt.length <= MAX_EXACT_TOKENIZER_INPUT_LENGTH && typeof Worker !== 'undefined') {
    try {
      return { countMode: 'exact', promptTokens: await encodeAsync(prompt) };
    } catch {
      // Token accounting is diagnostic context only and must never block the provider request.
    }
  }

  try {
    return { countMode: 'estimated', promptTokens: await estimatedEncodeAsync(prompt) };
  } catch {
    return { countMode: 'character', promptTokens: prompt.length };
  }
};

export const createKnowledgeBaseSummary = (params: {
  countMode: KnowledgeBasePromptTokenCountMode;
  diagnosticId?: string;
  promptTokens: number;
  queryRewritten: boolean;
  retrieval: RagChatRetrievalStats;
  scope: RagChatScopeStats;
}): ContextExportKnowledgeBaseSummary => ({
  countMode: params.countMode,
  diagnosticId: params.diagnosticId,
  promptTokens: params.promptTokens,
  queryRewritten: params.queryRewritten,
  retrieval: params.retrieval,
  scope: params.scope,
});

export const mergeKnowledgeBaseAllocation = (
  allocation: ContextExportAllocation | undefined,
  knowledgeBase: number,
): ContextExportAllocation => ({
  ...allocation,
  knowledgeBase,
  total: Math.max(0, (allocation?.total ?? 0) - (allocation?.knowledgeBase ?? 0)) + knowledgeBase,
});

export const attachKnowledgeBaseExportSummary = (
  request: ContextExportRequestContext | undefined,
  summary: ContextExportKnowledgeBaseSummary,
): ContextExportRequestContext | undefined =>
  request
    ? {
        ...request,
        allocation: mergeKnowledgeBaseAllocation(request.allocation, summary.promptTokens),
        knowledgeBase: summary,
      }
    : undefined;

export const getKnowledgeDiagnosticIdFromError = (error: unknown): string | undefined => {
  const match = String(error instanceof Error ? error.message : error).match(/\bkb_[\w-]{8,48}\b/);
  return match?.[0];
};

export const addKnowledgeDiagnosticIdToError = (error: unknown, diagnosticId?: string): Error => {
  if (error instanceof Error && (!diagnosticId || error.message.includes(diagnosticId)))
    return error;

  const message = error instanceof Error ? error.message : String(error);
  const suffix = diagnosticId ? ` (Diagnostic ID: ${diagnosticId})` : '';
  const next = new Error(`${message}${suffix}`);
  next.cause = error;
  return next;
};

export const createKnowledgeBasePreparationMessageError = (
  diagnosticId?: string,
): ChatMessageError => {
  const diagnosticSuffix = diagnosticId ? ` (Diagnostic ID: ${diagnosticId})` : '';
  const message = `Knowledge Base preparation failed. Retry the message.${diagnosticSuffix}`;

  return {
    body: diagnosticId ? { diagnosticId } : undefined,
    message,
    type: ChatErrorType.UnknownChatFetchError,
  };
};
