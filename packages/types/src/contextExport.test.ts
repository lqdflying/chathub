import { describe, expect, it } from 'vitest';

import { ContextExportRequestContextSchema } from './contextExport';
import { RAG_CHAT_RESULT_LIMIT } from './rag';

const createRequest = (selectedScores: number[]) => ({
  captureId: 'capture-1',
  continuationReason: 'initial',
  knowledgeBase: {
    countMode: 'exact',
    promptTokens: 42,
    queryRewritten: false,
    retrieval: {
      candidateCount: selectedScores.length,
      candidateLimit: 24,
      eligibleCount: selectedScores.length,
      minimumSimilarity: 0.2,
      resultLimit: RAG_CHAT_RESULT_LIMIT,
      selectedCount: selectedScores.length,
      selectedScores,
      strategy: 'cosine',
    },
    scope: {
      directFileCount: 1,
      expandedFileCount: 1,
      knowledgeBaseCount: 1,
    },
  },
  purpose: 'assistant',
  requestId: 'request-1',
  sequence: 0,
});

describe('ContextExportRequestContextSchema', () => {
  it('uses the chat retrieval result limit for selected scores', () => {
    const selectedScores = Array.from({ length: RAG_CHAT_RESULT_LIMIT }, () => 0.5);

    expect(ContextExportRequestContextSchema.safeParse(createRequest(selectedScores)).success).toBe(
      true,
    );
    expect(
      ContextExportRequestContextSchema.safeParse(createRequest([...selectedScores, 0.5])).success,
    ).toBe(false);
  });

  it('accepts only known Knowledge Base token count modes', () => {
    expect(ContextExportRequestContextSchema.safeParse(createRequest([0.5])).success).toBe(true);
    expect(
      ContextExportRequestContextSchema.safeParse({
        ...createRequest([0.5]),
        knowledgeBase: { ...createRequest([0.5]).knowledgeBase, countMode: 'unknown' },
      }).success,
    ).toBe(false);
  });
});
