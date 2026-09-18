import type { UIChatMessage } from '@lobechat/types';
import { TOOL_RESULT_CONTENT_MAX_CHARS, truncateToolResultContent } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { CONTEXT_CHARS_PER_TOKEN_ESTIMATE, LARGE_CONTEXT_WINDOW_TOKENS } from './contextCompaction';
import {
  estimateFixedContextOverheadTokens,
  estimateToolResultTruncationRecoveryTokens,
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

  it('keeps configured history limit separate from effective count when truncate is off', () => {
    const messages = [
      message('u1', 'user', 'short'),
      message('a1', 'assistant', 'short'),
      message('u2', 'user', 'short'),
    ];
    const diagnostics = getHistoryWindowDiagnostics({
      configuredHistoryCount: 100,
      enableHistoryCount: true,
      hasTopicSummary: false,
      historyCount: 100,
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messages,
    });

    expect(diagnostics.configuredHistoryCount).toBe(100);
    expect(diagnostics.effectiveHistoryCount).toBe(messages.length);
    expect(diagnostics.expanded).toBe(true);
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

  it('keeps truncation when templated pending input no longer fits a large window', () => {
    const pending = 'x'.repeat(80_000);
    const stored = [message('u1', 'user', 'short'), message('a1', 'assistant', 'short')];
    const storedOnly = resolveEffectiveHistoryWindow({
      enableHistoryCount: true,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messagesAfterCursor: stored,
    });
    const withPending = getHistoryWindowDiagnostics({
      configuredHistoryCount: 2,
      enableHistoryCount: true,
      hasTopicSummary: false,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messages: stored,
      pendingInput: pending,
    });

    expect(storedOnly.enableHistoryCount).toBe(false);
    expect(withPending.enableHistoryCount).toBe(true);
    expect(withPending.topicMessageCount).toBe(stored.length);
    expect(withPending.excludedByHistoryCount).toBe(1);
    expect(withPending.includedMessageCount).toBeLessThanOrEqual(stored.length);
  });

  it('keeps persisted-topic counts when a fitting text draft is pending', () => {
    const pending = 'short draft';
    const stored = [message('u1', 'user', 'short'), message('a1', 'assistant', 'short')];
    const diagnostics = getHistoryWindowDiagnostics({
      configuredHistoryCount: 2,
      enableHistoryCount: true,
      hasTopicSummary: false,
      historyCount: 2,
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messages: stored,
      pendingInput: pending,
    });

    expect(diagnostics.topicMessageCount).toBe(2);
    expect(diagnostics.includedMessageCount).toBeLessThanOrEqual(diagnostics.topicMessageCount);
    expect(diagnostics.effectiveHistoryCount).toBeLessThanOrEqual(diagnostics.topicMessageCount);
  });

  it('scales summary max tokens by assistance level', () => {
    expect(getContextCompactionMaxSummaryTokens('minimal')).toBe(400);
    expect(getContextCompactionMaxSummaryTokens('balanced')).toBe(600);
    expect(getContextCompactionMaxSummaryTokens('rich')).toBe(800);
  });

  describe('tool-result truncation (C3)', () => {
    const oversizedTool = (content: string): UIChatMessage =>
      ({ content, id: 'tool1', role: 'tool', tool_call_id: 'tc1' }) as UIChatMessage;

    it('caps oversized tool results by default so estimates match the wire', () => {
      const content = 't'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 100);
      const serialized = serializeMessageForContextEstimate(oversizedTool(content));

      expect(serialized).toBe(
        `tool:\n${'t'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS)}\n…[truncated 100 chars]\ntool_call_id:tc1`,
      );
    });

    it('keeps full tool content when capToolResults is false (growth signal)', () => {
      const content = 't'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 100);
      const serialized = serializeMessageForContextEstimate(oversizedTool(content), undefined, {
        capToolResults: false,
      });

      expect(serialized).toContain(content);
    });

    it('does not cap MCP tool results on the wire estimate', () => {
      const content = 't'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 100);
      const mcpTool = {
        content,
        id: 'tool1',
        plugin: { apiName: 'fetch', identifier: 'notion', type: 'mcp' },
        role: 'tool',
        tool_call_id: 'tc1',
      } as UIChatMessage;

      expect(serializeMessageForContextEstimate(mcpTool)).toContain(content);
      expect(estimateToolResultTruncationRecoveryTokens([mcpTool])).toBe(0);
    });

    it('leaves user and assistant content uncapped', () => {
      const content = 'u'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 100);
      expect(serializeMessageForContextEstimate(message('u1', 'user', content))).toContain(content);
      expect(serializeMessageForContextEstimate(message('a1', 'assistant', content))).toContain(
        content,
      );
    });

    it('estimates recoverable tokens from the deterministic cap', () => {
      const content = 't'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 1000);
      const messages = [
        message('u1', 'user'),
        oversizedTool(content),
        message('a1', 'assistant'),
      ];

      const recoverableChars =
        content.length - truncateToolResultContent(content).length;
      expect(estimateToolResultTruncationRecoveryTokens(messages)).toBe(
        Math.ceil(recoverableChars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE),
      );
      // Non-tool roles never contribute.
      expect(
        estimateToolResultTruncationRecoveryTokens([message('u1', 'user', 'x'.repeat(20_000))]),
      ).toBe(0);
    });
  });
});
