import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { LARGE_CONTEXT_WINDOW_TOKENS } from './contextCompaction';
import {
  estimateFixedContextOverheadTokens,
  getContextCompactionMaxSummaryTokens,
  getHistoryWindowDiagnostics,
  resolveEffectiveHistoryWindow,
  serializeMessageForContextEstimate,
  wrapHistorySummaryForTokenEstimate,
} from './contextUsageEstimate';

const message = (id: string, role: UIChatMessage['role'], content = id): UIChatMessage =>
  ({ content, id, role, updatedAt: 1 }) as UIChatMessage;

describe('contextUsageEstimate', () => {
  it('serializes role, content, and tool payloads', () => {
    expect(
      serializeMessageForContextEstimate({
        content: 'hello',
        role: 'assistant',
        tools: [{ apiName: 'x', arguments: '{}', id: 't1', identifier: 'p', type: 'default' }],
      }),
    ).toContain('assistant:');
    expect(
      serializeMessageForContextEstimate({
        content: 'hello',
        role: 'assistant',
        tools: [{ apiName: 'x', arguments: '{}', id: 't1', identifier: 'p', type: 'default' }],
      }),
    ).toContain('"apiName":"x"');
  });

  it('wraps history summary with the request XML framing', () => {
    const wrapped = wrapHistorySummaryForTokenEstimate('prior turns');
    expect(wrapped).toContain('<chat_history_summary>');
    expect(wrapped).toContain('prior turns');
    expect(wrapHistorySummaryForTokenEstimate('  ')).toBe('');
  });

  it('keeps configured historyCount on small context windows', () => {
    const messages = Array.from({ length: 40 }, (_, i) =>
      message(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `msg-${i}`),
    );
    expect(
      resolveEffectiveHistoryWindow({
        enableHistoryCount: true,
        historyCount: 20,
        maxTokens: 32_000,
        messagesAfterCursor: messages,
      }),
    ).toEqual({ enableHistoryCount: true, expanded: false, historyCount: 20 });
  });

  it('disables truncate when a large window can fit the full post-cursor history', () => {
    const messages = [
      message('u1', 'user', 'short'),
      message('a1', 'assistant', 'short'),
      message('u2', 'user', 'short'),
    ];
    const result = resolveEffectiveHistoryWindow({
      enableHistoryCount: true,
      fixedOverheadTokens: 1000,
      historyCount: 2,
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messagesAfterCursor: messages,
    });
    expect(result.enableHistoryCount).toBe(false);
    expect(result.expanded).toBe(true);
  });

  it('reports uncovered exclusions when history was dropped without a summary', () => {
    const messages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
    ];
    const diagnostics = getHistoryWindowDiagnostics({
      configuredHistoryCount: 2,
      enableCompressHistory: true,
      enableHistoryCount: true,
      hasTopicSummary: false,
      historyCount: 2,
      maxTokens: 8000,
      messages,
    });
    expect(diagnostics.includedMessageCount).toBeLessThan(diagnostics.topicMessageCount);
    expect(diagnostics.excludedByHistoryCount).toBeGreaterThan(0);
    expect(diagnostics.warnUncoveredExclusion).toBe(true);
  });

  it('still warns when a prior summary exists but newer turns fall outside the history window', () => {
    const messages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
      message('a3', 'assistant'),
      message('u4', 'user'),
    ];
    const diagnostics = getHistoryWindowDiagnostics({
      configuredHistoryCount: 2,
      cursorId: 'a1',
      enableCompressHistory: true,
      enableHistoryCount: true,
      hasTopicSummary: true,
      historyCount: 2,
      maxTokens: 8000,
      messages,
    });
    expect(diagnostics.excludedByCursor).toBeGreaterThan(0);
    expect(diagnostics.excludedByHistoryCount).toBeGreaterThan(0);
    expect(diagnostics.warnUncoveredExclusion).toBe(true);
  });

  it('treats a missing system role as zero overhead instead of throwing', () => {
    expect(
      estimateFixedContextOverheadTokens({
        systemRole: undefined,
        toolsString: '',
      }),
    ).toBe(0);
    expect(
      estimateFixedContextOverheadTokens({
        agentMemory: 'abcd',
        systemRole: undefined,
      }),
    ).toBe(2);
  });

  it('counts skill XML wrappers and ignores a one-shot input template string', () => {
    const skillInstructions = `<activated_skills>
<skill name="reviewer">
${'Review diffs carefully.'.repeat(10)}
</skill>
</activated_skills>`;
    const withSkills = estimateFixedContextOverheadTokens({
      skillInstructions,
      systemRole: 'Be concise.',
    });
    const withoutSkills = estimateFixedContextOverheadTokens({
      systemRole: 'Be concise.',
    });
    expect(withSkills).toBeGreaterThan(withoutSkills);
    expect(withSkills).toBe(
      estimateFixedContextOverheadTokens({
        skillInstructions,
        systemRole: 'Be concise.',
      }),
    );
  });

  it('scales summary max tokens by assistance level', () => {
    expect(getContextCompactionMaxSummaryTokens('minimal')).toBe(400);
    expect(getContextCompactionMaxSummaryTokens('balanced')).toBe(600);
    expect(getContextCompactionMaxSummaryTokens('rich')).toBe(800);
  });
});
