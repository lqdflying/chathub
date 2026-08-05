import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeAsync } from '@/utils/tokenizer';
import { estimatedEncodeAsync } from '@/utils/tokenizer/estimated';

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
  MAX_EXACT_TOKENIZER_INPUT_LENGTH: 10_000,
  encodeAsync: vi.fn(),
}));

vi.mock('@/utils/tokenizer/estimated', () => ({ estimatedEncodeAsync: vi.fn() }));

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
  vi.stubGlobal('Worker', class TokenizerWorker {});
  vi.mocked(encodeAsync).mockReset().mockResolvedValue(7);
  vi.mocked(estimatedEncodeAsync).mockReset().mockResolvedValue(5);
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
    expect(estimatedEncodeAsync).not.toHaveBeenCalled();
  });

  it('falls back to an estimated count when worker tokenization fails', async () => {
    vi.mocked(encodeAsync).mockRejectedValueOnce(new Error('worker unavailable'));

    await expect(countKnowledgeBasePromptTokens('prompt')).resolves.toEqual({
      countMode: 'estimated',
      promptTokens: 5,
    });
  });

  it('falls back to character length when exact and estimated counting fail', async () => {
    vi.mocked(encodeAsync).mockRejectedValueOnce(new Error('worker unavailable'));
    vi.mocked(estimatedEncodeAsync).mockRejectedValueOnce(new Error('estimator unavailable'));

    await expect(countKnowledgeBasePromptTokens('prompt')).resolves.toEqual({
      countMode: 'character',
      promptTokens: 6,
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
