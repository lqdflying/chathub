import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

import {
  EstimatedContextUsageProvider,
  useLiveEstimatedContextUsage,
} from './EstimatedContextUsageProvider';

const usage = vi.hoisted(() => ({
  calls: 0,
  value: {
    chatInstructionToken: 1,
    chatsToken: 2,
    historySummaryToken: 0,
    historyWindow: {
      configuredHistoryCount: 0,
      effectiveHistoryCount: 0,
      enableHistoryCount: false,
      excludedByCursor: 0,
      excludedByHistoryCount: 0,
      expanded: false,
      hasTopicSummary: false,
      includedMessageCount: 0,
      topicMessageCount: 0,
      warnUncoveredExclusion: false,
    },
    inputTokenCount: 0,
    knowledgeBaseToken: 0,
    maxTokens: 100,
    memoryToken: 0,
    ratio: 0.1,
    roleSettingsToken: 0,
    systemRoleToken: 0,
    toolsToken: 0,
    topicChatsToken: 0,
    totalToken: 10,
  },
}));

vi.mock('./useEstimatedContextUsage', () => ({
  useEstimatedContextUsage: () => {
    usage.calls += 1;
    return usage.value;
  },
}));

const Reader = ({ label }: { label: string }) => {
  const live = useLiveEstimatedContextUsage();
  return (
    <span data-testid={label}>
      {live.totalToken}:{live.maxTokens}
    </span>
  );
};

describe('EstimatedContextUsageProvider', () => {
  it('runs the estimate hook once for two consumers', () => {
    usage.calls = 0;

    render(
      <EstimatedContextUsageProvider>
        <Reader label="a" />
        <Reader label="b" />
      </EstimatedContextUsageProvider>,
    );

    expect(usage.calls).toBe(1);
    expect(screen.getByTestId('a').textContent).toBe('10:100');
    expect(screen.getByTestId('b').textContent).toBe('10:100');
  });
});
