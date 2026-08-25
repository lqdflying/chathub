import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
  CONTEXT_COMPACTION_REASONING_HEADROOM_TOKENS,
  buildSimpleCompletionSampling,
  getContextCompactionWatermarks,
  getMessagesAfterHistorySummaryCursor,
  getSettledCompactionPrefixes,
  resolvePendingCompactionHistory,
  selectMessageCountCompactionPrefix,
  selectMessagesForContext,
  splitCompactionBatches,
} from './contextCompaction';

const message = (id: string, role: UIChatMessage['role']): UIChatMessage =>
  ({ content: id, id, role, updatedAt: 1 }) as UIChatMessage;

describe('context compaction helpers', () => {
  const messages = [
    message('u1', 'user'),
    message('a1', 'assistant'),
    message('u2', 'user'),
    message('a2', 'assistant'),
    message('u3', 'user'),
  ];

  it('derives a 20 percentage point low watermark from the clamped high watermark', () => {
    expect(getContextCompactionWatermarks()).toEqual({ high: 0.8, low: 0.6 });
    expect(getContextCompactionWatermarks(0.95)).toEqual({ high: 0.95, low: 0.75 });
    expect(getContextCompactionWatermarks(0.2)).toEqual({ high: 0.5, low: 0.3 });
  });

  it('removes only messages already represented by a valid cursor', () => {
    expect(getMessagesAfterHistorySummaryCursor(messages, 'a1').map(({ id }) => id)).toEqual([
      'u2',
      'a2',
      'u3',
    ]);
    expect(getMessagesAfterHistorySummaryCursor(messages, 'missing')).toBe(messages);
  });

  it('rebuilds a legacy summary when no valid cursor exists', () => {
    expect(resolvePendingCompactionHistory({ historySummary: 'legacy', messages })).toMatchObject({
      pendingMessages: messages,
      previousSummary: '',
      rebuildingSummary: true,
    });
  });

  it('keeps the latest user turn and tool continuation out of eligible prefixes', () => {
    const withToolTail = [
      ...messages.slice(0, -1),
      message('u3', 'user'),
      message('tool-call', 'assistant'),
      message('tool-result', 'tool'),
    ];

    expect(
      getSettledCompactionPrefixes(withToolTail)
        .at(-1)
        ?.map(({ id }) => id),
    ).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('rounds a message-count overflow up to a complete turn', () => {
    expect(selectMessageCountCompactionPrefix(messages, 4).map(({ id }) => id)).toEqual([
      'u1',
      'a1',
    ]);
  });

  it('uses the same latest-user anchored window as the context engine', () => {
    const withToolTail = [
      ...messages,
      message('tool-call', 'assistant'),
      message('tool-result', 'tool'),
    ];
    expect(
      selectMessagesForContext({
        enableHistoryCount: true,
        historyCount: 2,
        messages: withToolTail,
      }).map(({ id }) => id),
    ).toEqual(['a2', 'u3', 'tool-call', 'tool-result']);
  });

  it('splits large deltas only between turns', () => {
    const longHistory = Array.from({ length: 6 }, (_, index) => [
      message(`u${index}`, 'user'),
      message(`a${index}`, 'assistant'),
    ]).flat();

    expect(
      splitCompactionBatches(longHistory, 5).map((batch) => batch.map(({ id }) => id)),
    ).toEqual([
      ['u0', 'a0', 'u1', 'a1'],
      ['u2', 'a2', 'u3', 'a3'],
      ['u4', 'a4', 'u5', 'a5'],
    ]);
  });
});

describe('buildSimpleCompletionSampling', () => {
  const summaryCap = CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS;
  const reasoningBudget = summaryCap + CONTEXT_COMPACTION_REASONING_HEADROOM_TOKENS;

  it('keeps the 400-token summary cap for non-reasoning models', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'summary-model',
        provider: 'summary-provider',
      }),
    ).toEqual({ max_tokens: summaryCap });
  });

  it('sends minimal GPT-5 effort and extra output budget for gpt-5-mini', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'gpt-5-mini',
        provider: 'openai',
      }),
    ).toEqual({
      max_tokens: reasoningBudget,
      reasoning_effort: 'minimal',
    });
  });

  it('keeps the GPT-5.5 quality floor instead of lowering effort to minimal', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'gpt-5.5',
        provider: 'openai',
      }),
    ).toEqual({
      max_tokens: reasoningBudget,
      reasoning_effort: 'high',
    });
  });

  it('disables Anthropic thinking and still adds reasoning headroom', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
      }),
    ).toEqual({
      max_tokens: reasoningBudget,
      thinking: { budget_tokens: 0, type: 'disabled' },
    });
  });
});
