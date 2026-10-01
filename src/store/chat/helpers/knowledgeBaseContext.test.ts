import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { countTokensDetailed } from '@/utils/tokenizer';

import {
  addKnowledgeDiagnosticIdToError,
  attachKnowledgeBaseExportSummary,
  countKnowledgeBasePromptTokens,
  createKnowledgeBasePreparationMessageError,
  createKnowledgeBaseSummary,
  getKnowledgeDiagnosticIdFromError,
  mergeKnowledgeBaseAllocation,
} from './knowledgeBaseContext';

vi.mock('@/utils/tokenizer', () => ({
  countTokensDetailed: vi.fn(),
}));

const summary = createKnowledgeBaseSummary({
  countMode: 'exact',
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

beforeEach(() => {
  vi.mocked(countTokensDetailed).mockReset().mockResolvedValue({ count: 7, mode: 'exact' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('knowledgeBaseContext', () => {
  it('uses exact worker tokenization when it is available', async () => {
    await expect(countKnowledgeBasePromptTokens('prompt')).resolves.toEqual({
      countMode: 'exact',
      promptTokens: 7,
    });
  });

  it('reports an estimated count when tokenization falls back', async () => {
    vi.mocked(countTokensDetailed).mockResolvedValueOnce({ count: 5, mode: 'fallback' });

    await expect(countKnowledgeBasePromptTokens('prompt')).resolves.toEqual({
      countMode: 'estimated',
      promptTokens: 5,
    });
  });

  it('reports an estimated zero when token counting throws', async () => {
    vi.mocked(countTokensDetailed).mockRejectedValueOnce(new Error('worker unavailable'));

    await expect(countKnowledgeBasePromptTokens('prompt')).resolves.toEqual({
      countMode: 'estimated',
      promptTokens: 0,
    });
  });

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

  it('creates a persistent generic chat error with the opaque diagnostic ID', () => {
    expect(createKnowledgeBasePreparationMessageError('kb_1234567890abcdef')).toEqual({
      body: { diagnosticId: 'kb_1234567890abcdef' },
      message:
        'Knowledge Base preparation failed. Retry the message. (Diagnostic ID: kb_1234567890abcdef)',
      type: ChatErrorType.UnknownChatFetchError,
    });
  });
});
