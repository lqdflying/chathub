import { describe, expect, it } from 'vitest';

import { formatHistoryWindowLimitLine } from './formatHistoryWindowLimitLine';

const t = (key: string, options?: { count?: number }) => {
  if (key === 'tokenDetails.historyWindow.limit') {
    return `History limit ${options?.count}`;
  }

  if (key === 'tokenDetails.historyWindow.expandedLimit') {
    return `Large-context expanded to ${options?.count}`;
  }

  return key;
};

describe('formatHistoryWindowLimitLine', () => {
  it('shows only the configured limit when expansion does not exceed it', () => {
    expect(
      formatHistoryWindowLimitLine(
        {
          configuredHistoryCount: 100,
          effectiveHistoryCount: 3,
          expanded: true,
        },
        t,
      ),
    ).toBe('History limit 100');
  });

  it('appends the expanded limit when runtime exceeds the configured cap', () => {
    expect(
      formatHistoryWindowLimitLine(
        {
          configuredHistoryCount: 2,
          effectiveHistoryCount: 3,
          expanded: true,
        },
        t,
      ),
    ).toBe('History limit 2 · Large-context expanded to 3');
  });
});
