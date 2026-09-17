import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { describe, expect, it } from 'vitest';

import { createEmptyCompletionAtContextCeilingError } from '@/helpers/emptyCompletionAtContextCeiling';
import {
  createCompactionSummarizerTimeoutSignal,
  DEFAULT_COMPACTION_SUMMARIZER_TIMEOUT_MS,
  isContextOverflowError,
  resolveCompactionSummarizerTimeoutMs,
} from './isContextOverflowError';

describe('isContextOverflowError', () => {
  it('matches the structured ExceededContextWindow type', () => {
    expect(
      isContextOverflowError({
        message: 'whatever',
        type: AgentRuntimeErrorType.ExceededContextWindow,
      }),
    ).toBe(true);
  });

  it('matches the empty-completion-at-ceiling error shape', () => {
    const error = createEmptyCompletionAtContextCeilingError({
      contextWindowTokens: 1_048_576,
      totalInputTokens: 1_048_570,
      totalOutputTokens: 0,
    });
    expect(isContextOverflowError(error)).toBe(true);
  });

  it.each([
    'This model\'s maximum context length is 128000 tokens',
    'Error code: 400 - context_length_exceeded',
    'prompt is too long: 200000 tokens > 199999 maximum',
    'request_too_large',
    'The input token count exceeds the maximum number of tokens allowed',
    'invalid params, context window exceeds limit (2013)',
    'string_above_max_length',
    'moonshot: ExceededContextWindow [ExceededContextWindow]',
  ])('matches provider overflow signature: %s', (message) => {
    expect(isContextOverflowError(new Error(message))).toBe(true);
    expect(isContextOverflowError({ message, type: 'ProviderBizError' })).toBe(true);
  });

  it('matches MiniMax 2013 in structured body fields', () => {
    expect(
      isContextOverflowError({
        body: { status_code: 2013 },
        message: 'invalid params',
        type: 'ProviderBizError',
      }),
    ).toBe(true);
    expect(
      isContextOverflowError({
        body: { base_resp: { status_code: 2013 } },
        message: 'invalid params',
        type: 'ProviderBizError',
      }),
    ).toBe(true);
  });

  it('matches overflow text inside a string body', () => {
    expect(
      isContextOverflowError({
        body: 'This model\'s maximum context length is 128000 tokens',
        message: 'Bad Request',
        type: 'ProviderBizError',
      }),
    ).toBe(true);
  });

  it.each([
    new Error('rate limit exceeded'),
    { message: 'invalid api key', type: 'InvalidProviderAPIKey' },
    { body: { status_code: 1004 }, message: 'unauthorized', type: 'ProviderBizError' },
    undefined,
    null,
    'plain string without a signature',
  ])('does not match non-overflow errors: %s', (error) => {
    expect(isContextOverflowError(error)).toBe(false);
  });

  it('does not match an unrelated 2013-looking message without context wording', () => {
    expect(isContextOverflowError(new Error('invoice 2013 overdue'))).toBe(false);
  });
});

describe('resolveCompactionSummarizerTimeoutMs', () => {
  it('defaults to 120s', () => {
    delete process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS;
    expect(resolveCompactionSummarizerTimeoutMs()).toBe(DEFAULT_COMPACTION_SUMMARIZER_TIMEOUT_MS);
  });

  it('honors a valid env override and ignores invalid values', () => {
    process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS = '5000';
    expect(resolveCompactionSummarizerTimeoutMs()).toBe(5000);
    process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS = '-3';
    expect(resolveCompactionSummarizerTimeoutMs()).toBe(DEFAULT_COMPACTION_SUMMARIZER_TIMEOUT_MS);
    process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS = 'abc';
    expect(resolveCompactionSummarizerTimeoutMs()).toBe(DEFAULT_COMPACTION_SUMMARIZER_TIMEOUT_MS);
    delete process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS;
  });
});

describe('createCompactionSummarizerTimeoutSignal', () => {
  it('fires on the deadline and reports isSummarizerTimeout', async () => {
    process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS = '20';
    const { isSummarizerTimeout, signal } = createCompactionSummarizerTimeoutSignal();
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(signal.aborted).toBe(true);
    expect(isSummarizerTimeout()).toBe(true);
    delete process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS;
  });

  it('parent abort wins over the timeout classification', async () => {
    process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS = '20';
    const parent = new AbortController();
    const { isSummarizerTimeout, signal } = createCompactionSummarizerTimeoutSignal(
      parent.signal,
    );
    parent.abort('stop');
    expect(signal.aborted).toBe(true);
    expect(isSummarizerTimeout()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Deadline fired later, but the parent aborted first — still not a timeout.
    expect(isSummarizerTimeout()).toBe(false);
    delete process.env.CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS;
  });
});
