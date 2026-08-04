import { describe, expect, it } from 'vitest';

import {
  addKnowledgeDiagnosticIdToError,
  attachKnowledgeBaseExportSummary,
  createKnowledgeBaseSummary,
  getKnowledgeDiagnosticIdFromError,
  mergeKnowledgeBaseAllocation,
} from './knowledgeBaseContext';

const summary = createKnowledgeBaseSummary({
  diagnosticId: 'kb_1234567890abcdef',
  promptTokens: 25,
  queryRewritten: true,
  retrieval: {
    candidateCount: 10,
    candidateLimit: 24,
    eligibleCount: 4,
    minimumSimilarity: 0.2,
    resultLimit: 8,
    selectedCount: 2,
    selectedScores: [0.9, 0.7],
    strategy: 'cosine',
  },
  scope: { directFileCount: 1, expandedFileCount: 3, knowledgeBaseCount: 1 },
});

describe('knowledgeBaseContext', () => {
  it('replaces an existing Knowledge Base bucket instead of double counting it', () => {
    expect(mergeKnowledgeBaseAllocation({ knowledgeBase: 10, total: 100 }, 25)).toEqual({
      knowledgeBase: 25,
      total: 115,
    });
  });

  it('attaches the bounded summary and allocation to one export request', () => {
    const request = attachKnowledgeBaseExportSummary(
      {
        allocation: { chatMessages: 75, total: 75 },
        captureId: 'capture-1',
        continuationReason: 'initial',
        purpose: 'assistant',
        requestId: 'request-1',
        sequence: 0,
      },
      summary,
    );

    expect(request).toMatchObject({
      allocation: { chatMessages: 75, knowledgeBase: 25, total: 100 },
      knowledgeBase: summary,
    });
  });

  it('preserves and extracts opaque diagnostic IDs without duplicating them', () => {
    const original = new Error('RAG failed (Diagnostic ID: kb_1234567890abcdef)');

    expect(getKnowledgeDiagnosticIdFromError(original)).toBe('kb_1234567890abcdef');
    expect(addKnowledgeDiagnosticIdToError(original, 'kb_1234567890abcdef')).toBe(original);
  });
});
