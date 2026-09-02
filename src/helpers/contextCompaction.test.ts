import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildDeepSeekPayload } from '../../packages/model-runtime/src/providers/deepseek';
import { buildMimoPayload } from '../../packages/model-runtime/src/providers/mimo';
import { buildZhipuPayload } from '../../packages/model-runtime/src/providers/zhipu';
import {
  COMPACTION_FINGERPRINT_HEX_PATTERN,
  CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
  CONTEXT_COMPACTION_REASONING_HEADROOM_TOKENS,
  LARGE_CONTEXT_WINDOW_TOKENS,
  buildOversizedCompactionTurnStub,
  buildSimpleCompletionSampling,
  createCompactionFingerprint,
  estimateCompactionPromptTokens,
  getCompactionSummarizerInputBudget,
  getContextCompactionWatermarks,
  getMessagesAfterHistorySummaryCursor,
  getSettledCompactionPrefixes,
  parseCompactionSummarizerContextWindow,
  resolveEffectiveHistoryWindow,
  resolvePendingCompactionHistory,
  selectMessageCountCompactionPrefix,
  selectMessagesForContext,
  splitCompactionBatches,
} from './contextCompaction';
import { conversationGenerationIdempotencyKey } from './conversationGenerationIdempotency';

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

  it('counts per-user input templates when deciding large-window expansion', () => {
    const longUser = 'u'.repeat(8000);
    const turns = Array.from({ length: 10 }, (_, index) => [
      message(`u${index}`, 'user'),
      message(`a${index}`, 'assistant'),
    ]).flat().map((item) =>
      item.role === 'user' ? { ...item, content: longUser } : item,
    );
    const inputTemplate = `${'P'.repeat(2000)}{{text}}`;
    const skillOverhead = Math.ceil('S'.repeat(50_000).length / 2);

    const withoutPerUser = resolveEffectiveHistoryWindow({
      enableHistoryCount: true,
      fixedOverheadTokens: skillOverhead,
      historyCount: 2,
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messagesAfterCursor: turns,
    });
    const withPerUser = resolveEffectiveHistoryWindow({
      enableHistoryCount: true,
      fixedOverheadTokens: skillOverhead,
      historyCount: 2,
      inputTemplate,
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messagesAfterCursor: turns,
    });

    expect(withoutPerUser.enableHistoryCount).toBe(false);
    expect(withPerUser.enableHistoryCount).toBe(true);
    expect(withPerUser.historyCount).toBeGreaterThanOrEqual(2);
    expect(withPerUser.historyCount).toBeLessThan(turns.length);
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

  it('keeps a complete user/assistant turn together when the pair exceeds the summarizer budget', () => {
    const bulky = (id: string, role: UIChatMessage['role']): UIChatMessage =>
      ({ content: '汉'.repeat(20_000), id, role, updatedAt: 1 }) as UIChatMessage;
    const history = [
      bulky('u0', 'user'),
      bulky('a0', 'assistant'),
      bulky('u1', 'user'),
      bulky('a1', 'assistant'),
    ];
    const window = 80_000;
    const budget = getCompactionSummarizerInputBudget(window, CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS);
    expect(estimateCompactionPromptTokens([history[0]])).toBeLessThanOrEqual(budget);
    expect(estimateCompactionPromptTokens(history.slice(0, 2))).toBeGreaterThan(budget);

    const batches = splitCompactionBatches(history, 40, {
      summarizerContextWindow: window,
      summaryMaxTokens: CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
    });
    expect(batches.map((batch) => batch.map(({ id }) => id))).toEqual([
      ['u0', 'a0'],
      ['u1', 'a1'],
    ]);
    for (const batch of batches) {
      expect(batch.at(-1)?.role).not.toBe('user');
    }
  });

  it('builds a bounded oversized-turn stub without message content', () => {
    const stub = buildOversizedCompactionTurnStub(
      [
        { content: 'SECRET_PAYLOAD', id: 'u0', role: 'user', updatedAt: 1 } as UIChatMessage,
        { content: 'TOOL_DUMP', id: 'a0', role: 'assistant', updatedAt: 1 } as UIChatMessage,
      ],
      'Prior summary',
    );
    expect(stub).toContain('Prior summary');
    expect(stub).toContain('oversized message');
    expect(stub).toContain('1 user');
    expect(stub).toContain('1 assistant');
    expect(stub).not.toContain('SECRET_PAYLOAD');
    expect(stub).not.toContain('TOOL_DUMP');
  });

  it('keeps the newest running-summary tail when bounding repeated oversized stubs', () => {
    const prior = `${'OLDEST-MARKER '}${'x'.repeat(12_400)} LATEST-MARKER`;
    const bounded = buildOversizedCompactionTurnStub(
      [{ content: 'SECRET_PAYLOAD', id: 'u0', role: 'user', updatedAt: 1 } as UIChatMessage],
      prior,
    );
    expect(bounded.length).toBeLessThanOrEqual(12_000);
    expect(bounded).toContain('LATEST-MARKER');
    expect(bounded).not.toContain('OLDEST-MARKER');
    expect(bounded).toContain('Earlier topic summary truncated');
    expect(bounded.match(/oversized message/g)?.length).toBe(1);
    expect(bounded).not.toContain('SECRET_PAYLOAD');
  });

  it('rejects non-positive or non-integer summarizer windows', () => {
    expect(parseCompactionSummarizerContextWindow(8192)).toBe(8192);
    expect(parseCompactionSummarizerContextWindow(1.5)).toBeUndefined();
    expect(parseCompactionSummarizerContextWindow(0)).toBeUndefined();
    expect(parseCompactionSummarizerContextWindow(20_000_000)).toBeUndefined();
  });
});

describe('buildSimpleCompletionSampling', () => {
  const summaryCap = CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS;
  const reasoningBudget = summaryCap + CONTEXT_COMPACTION_REASONING_HEADROOM_TOKENS;

  it('omits max_tokens unless the caller opts into a summary cap', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'gpt-4o',
        provider: 'openai',
      }),
    ).toEqual({});
    expect(
      buildSimpleCompletionSampling({
        model: 'gpt-5-mini',
        provider: 'openai',
      }),
    ).toEqual({ reasoning_effort: 'minimal' });
  });

  it('keeps the 400-token summary cap for listed non-reasoning models', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'gpt-4o',
        provider: 'openai',
        summaryMaxTokens: summaryCap,
      }),
    ).toEqual({ max_tokens: summaryCap });
  });

  it('gives unlisted models conservative reasoning headroom without inventing thinking fields', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'deepseek-r1:70b',
        provider: 'ollama',
        summaryMaxTokens: summaryCap,
      }),
    ).toEqual({ max_tokens: reasoningBudget });
  });

  it('does not inherit a foreign provider card for the same model id', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'deepseek-v4-pro',
        provider: 'ollama',
        summaryMaxTokens: summaryCap,
      }),
    ).toEqual({ max_tokens: reasoningBudget });
  });

  it('sends minimal GPT-5 effort and extra output budget for gpt-5-mini', () => {
    expect(
      buildSimpleCompletionSampling({
        model: 'gpt-5-mini',
        provider: 'openai',
        summaryMaxTokens: summaryCap,
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
        summaryMaxTokens: summaryCap,
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
        summaryMaxTokens: summaryCap,
      }),
    ).toEqual({
      max_tokens: reasoningBudget,
      thinking: { budget_tokens: 0, type: 'disabled' },
    });
  });

  it.each(['deepseek-v4-pro', 'deepseek-v4-flash'] as const)(
    'disables default-on DeepSeek thinking for %s',
    (model) => {
      const sampling = buildSimpleCompletionSampling({
        model,
        provider: 'deepseek',
        summaryMaxTokens: summaryCap,
      });

      expect(sampling).toEqual({
        max_tokens: reasoningBudget,
        thinking: { budget_tokens: 0, type: 'disabled' },
      });

      const upstream = buildDeepSeekPayload({
        max_tokens: sampling.max_tokens,
        messages: [{ content: 'Hello', role: 'user' }],
        model,
        thinking: sampling.thinking,
      } as any);

      expect(upstream.max_tokens).toBe(reasoningBudget);
      expect(upstream.thinking).toEqual({ type: 'disabled' });
      expect(upstream).not.toHaveProperty('reasoning_effort');
    },
  );

  it.each(['glm-5.3', 'glm-5.3-flash'] as const)(
    'sends low reasoning effort instead of disabled thinking for forced GLM %s',
    (model) => {
      expect(
        buildSimpleCompletionSampling({
          model,
          provider: 'zhipu',
        }),
      ).toEqual({ reasoning_effort: 'low' });

      const sampling = buildSimpleCompletionSampling({
        model,
        provider: 'zhipu',
        summaryMaxTokens: summaryCap,
      });

      expect(sampling).toEqual({
        max_tokens: reasoningBudget,
        reasoning_effort: 'low',
      });
      expect(sampling).not.toHaveProperty('thinking');

      const upstream = buildZhipuPayload({
        max_tokens: sampling.max_tokens,
        messages: [{ content: 'Hello', role: 'user' }],
        model,
        reasoning_effort: sampling.reasoning_effort,
        thinking: sampling.thinking,
      } as any);

      expect(upstream.max_tokens).toBe(reasoningBudget);
      expect(upstream.reasoning_effort).toBe('low');
      expect(upstream).not.toHaveProperty('thinking');
    },
  );

  it('still disables thinking on GLM-5.2 simple completions', () => {
    const sampling = buildSimpleCompletionSampling({
      model: 'glm-5.2',
      provider: 'zhipu',
      summaryMaxTokens: summaryCap,
    });

    expect(sampling).toEqual({
      max_tokens: reasoningBudget,
      thinking: { budget_tokens: 0, type: 'disabled' },
    });

    const upstream = buildZhipuPayload({
      max_tokens: sampling.max_tokens,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'glm-5.2',
      thinking: sampling.thinking,
    } as any);

    expect(upstream.thinking).toEqual({ type: 'disabled' });
    expect(upstream).not.toHaveProperty('reasoning_effort');
  });

  it('does not invent reasoning_effort for forced-thinking GLM-4.7', () => {
    const sampling = buildSimpleCompletionSampling({
      model: 'glm-4.7',
      provider: 'zhipu',
      summaryMaxTokens: summaryCap,
    });

    expect(sampling).toEqual({
      max_tokens: reasoningBudget,
      thinking: { budget_tokens: 0, type: 'disabled' },
    });
    expect(sampling).not.toHaveProperty('reasoning_effort');
  });

  it.each(['mimo-v2.5-pro', 'mimo-v2.5'] as const)(
    'disables default-on Xiaomi MiMo thinking for %s',
    (model) => {
      const sampling = buildSimpleCompletionSampling({
        model,
        provider: 'mimo',
        summaryMaxTokens: summaryCap,
      });

      expect(sampling).toEqual({
        max_tokens: reasoningBudget,
        thinking: { budget_tokens: 0, type: 'disabled' },
      });

      const upstream = buildMimoPayload({
        max_tokens: sampling.max_tokens,
        messages: [{ content: 'Hello', role: 'user' }],
        model,
        thinking: sampling.thinking,
      });

      expect((upstream as any).max_completion_tokens).toBe(reasoningBudget);
      expect(upstream).not.toHaveProperty('max_tokens');
      expect(upstream.thinking).toEqual({ type: 'disabled' });
    },
  );

  it('expands history on large context windows when the full topic still fits', () => {
    const longTopic = Array.from({ length: 30 }, (_, index) =>
      message(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', `turn-${index}`),
    );
    expect(
      resolveEffectiveHistoryWindow({
        enableHistoryCount: true,
        fixedOverheadTokens: 2000,
        historyCount: 20,
        maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
        messagesAfterCursor: longTopic,
      }),
    ).toMatchObject({ enableHistoryCount: false, expanded: true });
  });

  it('selects a message-count prefix that covers every row the slicer excludes with tool tails', () => {
    const withTail = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
      message('a3', 'assistant'),
      message('tool3', 'tool'),
    ];
    // Window setting stays 2 even though included rows become a2,u3,a3,tool3.
    const included = selectMessagesForContext({
      enableHistoryCount: true,
      historyCount: 2,
      messages: withTail,
    });
    expect(included.map(({ id }) => id)).toEqual(['a2', 'u3', 'a3', 'tool3']);

    const prefix = selectMessageCountCompactionPrefix(withTail, 2);
    expect(prefix.map(({ id }) => id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    // Inflating the setting with included.length (4) would wrongly drop only u1,a1.
    expect(selectMessageCountCompactionPrefix(withTail, included.length).map(({ id }) => id)).toEqual(
      ['u1', 'a1'],
    );
  });

  it('changes the compaction fingerprint when candidate content changes at the same length', () => {
    const before = createCompactionFingerprint({
      cursorId: 'a1',
      messages: [message('a2', 'assistant')],
      summary: 'existing',
    });
    const after = createCompactionFingerprint({
      cursorId: 'a1',
      messages: [{ ...message('a2', 'assistant'), content: 'b2' }],
      summary: 'existing',
    });
    expect('b2').toHaveLength(message('a2', 'assistant').content.length);
    expect(after).not.toBe(before);
    expect(after).toMatch(COMPACTION_FINGERPRINT_HEX_PATTERN);
    expect(before).toMatch(COMPACTION_FINGERPRINT_HEX_PATTERN);
  });

  it('hashes large candidate text to a fixed digest that does not contain the source', () => {
    const secret = 'SECRET-PATIENT-NAME';
    const huge = `${secret}${'x'.repeat(1_000_000 - secret.length)}`;
    const digest = createCompactionFingerprint({
      cursorId: 'a1',
      messages: [{ content: huge, id: 'a2', role: 'assistant' }],
      summary: 'existing',
    });
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(COMPACTION_FINGERPRINT_HEX_PATTERN);
    expect(digest).not.toContain(secret);
    expect(
      createCompactionFingerprint({
        cursorId: 'a1',
        messages: [{ content: huge, id: 'a2', role: 'assistant' }],
        summary: 'existing',
      }),
    ).toBe(digest);

    const key = conversationGenerationIdempotencyKey('compaction', 'topic-1', digest);
    expect(key).not.toContain(secret);
    expect(key.length).toBeLessThanOrEqual(180);
  });

  it('does not collide when candidate content contains the former fingerprint delimiter', () => {
    const left = createCompactionFingerprint({
      cursorId: 'a1',
      messages: [
        { content: 'left\u001Fa2:assistant:right', id: 'u1', role: 'user' },
        { content: 'tail', id: 'a2', role: 'assistant' },
      ],
      summary: 'existing',
    });
    const right = createCompactionFingerprint({
      cursorId: 'a1',
      messages: [
        { content: 'left', id: 'u1', role: 'user' },
        { content: 'right\u001Fa2:assistant:tail', id: 'a2', role: 'assistant' },
      ],
      summary: 'existing',
    });
    expect(left).toMatch(COMPACTION_FINGERPRINT_HEX_PATTERN);
    expect(right).toMatch(COMPACTION_FINGERPRINT_HEX_PATTERN);
    expect(left).not.toBe(right);
  });

  it('treats missing and empty cursor or summary as the same fingerprint preimage', () => {
    const messages = [
      { content: 'left', id: 'u1', role: 'user' as const },
      { content: 'right', id: 'a2', role: 'assistant' as const },
    ];
    expect(
      createCompactionFingerprint({
        cursorId: undefined,
        messages,
        summary: undefined,
      }),
    ).toBe(
      createCompactionFingerprint({
        cursorId: '',
        messages,
        summary: '',
      }),
    );
  });
});
