import type {
  ContextExportAllocation,
  ContextExportKnowledgeBaseSummary,
  ContextExportRequestContext,
  RagChatRetrievalStats,
  RagChatScopeStats,
} from '@lobechat/types';

import { encodeAsync } from '@/utils/tokenizer';

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

export const countKnowledgeBasePromptTokens = async (prompt: string) =>
  prompt ? encodeAsync(prompt) : 0;

export const createKnowledgeBaseSummary = (params: {
  diagnosticId?: string;
  promptTokens: number;
  queryRewritten: boolean;
  retrieval: RagChatRetrievalStats;
  scope: RagChatScopeStats;
}): ContextExportKnowledgeBaseSummary => ({
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
