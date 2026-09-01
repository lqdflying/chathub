import { describe, expect, it } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import { applyReportedInputTokenFloor, getLatestReportedInputTokens } from './reportedContextTokens';

describe('reported context token floor', () => {
  it('reads the newest settled assistant input total', () => {
    expect(
      getLatestReportedInputTokens([
        { content: 'older', metadata: { totalInputTokens: 100 }, role: 'assistant' },
        { content: 'hi', role: 'user' },
        { content: 'latest', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
      ]),
    ).toBe(1_048_570);
  });

  it('skips in-flight assistants and unwraps nested usage', () => {
    expect(
      getLatestReportedInputTokens([
        {
          content: 'done',
          metadata: { usage: { totalInputTokens: 900 } },
          role: 'assistant',
        },
        { content: LOADING_FLAT, metadata: { totalInputTokens: 50 }, role: 'assistant' },
      ]),
    ).toBe(900);
  });

  it('ignores provider usage recorded at or before a compaction timestamp', () => {
    expect(
      getLatestReportedInputTokens(
        [
          {
            content: 'protected',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
            updatedAt: 1000,
          },
        ],
        { minExclusiveUpdatedAt: 2000 },
      ),
    ).toBeUndefined();
    expect(
      getLatestReportedInputTokens(
        [
          {
            content: 'fresh',
            metadata: { totalInputTokens: 400 },
            role: 'assistant',
            updatedAt: 3000,
          },
        ],
        { minExclusiveUpdatedAt: 2000 },
      ),
    ).toBe(400);
  });

  it('floors an underestimate with the provider-reported input', () => {
    expect(applyReportedInputTokenFloor(589_811, 1_048_570)).toEqual({
      chatsTokenDelta: 1_048_570 - 589_811,
      totalToken: 1_048_570,
    });
    expect(applyReportedInputTokenFloor(900_000, 100)).toEqual({
      chatsTokenDelta: 0,
      totalToken: 900_000,
    });
  });
});
