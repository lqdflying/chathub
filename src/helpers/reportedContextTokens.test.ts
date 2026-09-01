import { describe, expect, it } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import {
  applyReportedInputTokenFloor,
  getEffectiveReportedInputTokenFloorAfterMessageId,
  getLatestReportedInputTokenSourceId,
  getLatestReportedInputTokens,
  getReportedInputTokenFloorBoundaryId,
  messagesAfterId,
  nextReportedInputTokenFloorAfterMessageId,
  withReportedInputTokenFloorMetadata,
} from './reportedContextTokens';

describe('reported context token floor', () => {
  it('reads the newest settled assistant input total', () => {
    expect(
      getLatestReportedInputTokens([
        { content: 'older', id: 'a0', metadata: { totalInputTokens: 100 }, role: 'assistant' },
        { content: 'hi', id: 'u1', role: 'user' },
        {
          content: 'latest',
          id: 'a1',
          metadata: { totalInputTokens: 1_048_570 },
          role: 'assistant',
        },
      ]),
    ).toBe(1_048_570);
    expect(
      getLatestReportedInputTokenSourceId([
        { content: 'older', id: 'a0', metadata: { totalInputTokens: 100 }, role: 'assistant' },
        {
          content: 'latest',
          id: 'a1',
          metadata: { totalInputTokens: 1_048_570 },
          role: 'assistant',
        },
      ]),
    ).toBe('a1');
  });

  it('skips in-flight assistants and unwraps nested usage', () => {
    expect(
      getLatestReportedInputTokens([
        {
          content: 'done',
          id: 'a1',
          metadata: { usage: { totalInputTokens: 900 } },
          role: 'assistant',
        },
        { content: LOADING_FLAT, id: 'a2', metadata: { totalInputTokens: 50 }, role: 'assistant' },
      ]),
    ).toBe(900);
  });

  it('ignores the protected assistant after an identity watermark even if updatedAt is newer', () => {
    expect(
      getLatestReportedInputTokens(
        [
          {
            content: 'protected',
            id: 'a2',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
            updatedAt: 3000,
          },
        ],
        { afterMessageId: 'a2' },
      ),
    ).toBeUndefined();
  });

  it('floors a later assistant even when that row has older timestamps', () => {
    expect(
      getLatestReportedInputTokens(
        [
          {
            content: 'protected',
            id: 'a2',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
            updatedAt: 9000,
          },
          {
            content: 'fresh',
            id: 'a3',
            metadata: { totalInputTokens: 400 },
            role: 'assistant',
            updatedAt: 100,
          },
        ],
        { afterMessageId: 'a2' },
      ),
    ).toBe(400);
  });

  it('fail-closes the floor window when the watermark row is missing', () => {
    expect(
      messagesAfterId(
        [
          {
            content: 'older',
            id: 'a1',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
          },
          { content: 'later user', id: 'u3', role: 'user' },
        ],
        'deleted-boundary',
      ),
    ).toEqual([]);
    expect(
      getLatestReportedInputTokens(
        [
          {
            content: 'older',
            id: 'a1',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
          },
        ],
        { afterMessageId: 'deleted-boundary' },
      ),
    ).toBeUndefined();
  });

  it('includes an in-flight assistant in the compaction generation boundary', () => {
    expect(
      getReportedInputTokenFloorBoundaryId([
        {
          content: 'protected',
          id: 'a2',
          metadata: { totalInputTokens: 1_048_570 },
          role: 'assistant',
        },
        { content: LOADING_FLAT, id: 'a3', role: 'assistant' },
      ]),
    ).toBe('a3');
    expect(
      getLatestReportedInputTokens(
        [
          {
            content: 'protected',
            id: 'a2',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
          },
          { content: 'final', id: 'a3', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        ],
        { afterMessageId: 'a3' },
      ),
    ).toBeUndefined();
  });

  it('treats a compacted topic without a stored watermark as already-seen assistants', () => {
    const messages = [
      {
        content: 'stale',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
    ];
    expect(
      getEffectiveReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        messages,
      }),
    ).toBe('a2');
    expect(getLatestReportedInputTokens(messages, { afterMessageId: 'a2' })).toBeUndefined();
  });

  it('records the remaining usage-reporting assistant as the next floor watermark', () => {
    expect(
      withReportedInputTokenFloorMetadata(
        { reportedInputTokenFloorAfterMessageId: 'old' },
        [
          {
            content: 'protected',
            id: 'a2',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
          },
        ],
      ).reportedInputTokenFloorAfterMessageId,
    ).toBe('a2');
    expect(
      withReportedInputTokenFloorMetadata(
        { reportedInputTokenFloorAfterMessageId: 'a2' },
        [{ content: 'hi', id: 'u3', role: 'user' }],
      ).reportedInputTokenFloorAfterMessageId,
    ).toBe('u3');
    expect(
      withReportedInputTokenFloorMetadata(
        {},
        [
          {
            content: 'protected',
            id: 'a2',
            metadata: { totalInputTokens: 1_048_570 },
            role: 'assistant',
          },
          { content: LOADING_FLAT, id: 'a3', role: 'assistant' },
        ],
      ).reportedInputTokenFloorAfterMessageId,
    ).toBe('a3');
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

  it('keeps a stored marker that HistoryTruncate dropped and floors a later selected assistant', () => {
    const topicMessages = [
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant' as const,
      },
      { content: 'next', id: 'u3', role: 'user' as const },
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant' as const,
      },
    ];
    const selected = topicMessages.slice(1);
    expect(
      getEffectiveReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        messages: selected,
        storedAfterMessageId: 'a2',
        topicMessages,
      }),
    ).toBe('a2');
    expect(
      getLatestReportedInputTokens(selected, {
        afterMessageId: 'a2',
        lookupMessages: topicMessages,
      }),
    ).toBe(700_000);
    expect(messagesAfterId(selected, 'a2', topicMessages).map(({ id }) => id)).toEqual(['u3', 'a3']);
  });

  it('persists a stable migration boundary so a later assistant can floor', () => {
    const stale = [
      {
        content: 'stale',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant' as const,
      },
    ];
    expect(
      nextReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        topicMessages: stale,
      }),
    ).toBe('a2');
    const afterMigration = [
      ...stale,
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant' as const,
      },
    ];
    expect(
      getEffectiveReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        messages: afterMigration,
        storedAfterMessageId: 'a2',
        topicMessages: afterMigration,
      }),
    ).toBe('a2');
    expect(getLatestReportedInputTokens(afterMigration, { afterMessageId: 'a2' })).toBe(700_000);
  });

  it('rotates a missing stored marker to the remaining post-cursor assistant', () => {
    const remaining = [
      {
        content: 'older-protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant' as const,
      },
      { content: 'later', id: 'u3', role: 'user' as const },
    ];
    expect(
      nextReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        storedAfterMessageId: 'deleted-a3',
        topicMessages: remaining,
      }),
    ).toBe('a2');
    const afterRotate = [
      ...remaining,
      {
        content: 'fresh',
        id: 'a4',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant' as const,
      },
    ];
    expect(getLatestReportedInputTokens(afterRotate, {
        afterMessageId: 'a2',
        lookupMessages: afterRotate,
      }),
    ).toBe(700_000);
  });

  it('keeps the compaction cursor as the boundary when no post-cursor row remains', () => {
    expect(
      nextReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        storedAfterMessageId: 'u3',
        topicMessages: [
          { content: 'old', id: 'u1', role: 'user' },
          { content: 'old-a', id: 'a1', role: 'assistant' },
        ],
      }),
    ).toBe('a1');
    expect(
      withReportedInputTokenFloorMetadata({ historySummaryLastMessageId: 'a1' }, [])
        .reportedInputTokenFloorAfterMessageId,
    ).toBe('a1');
    expect(
      getEffectiveReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        messages: [
          { content: 'old', id: 'u1', role: 'user' },
          { content: 'old-a', id: 'a1', role: 'assistant' },
        ],
        storedAfterMessageId: 'a1',
      }),
    ).toBe('a1');
    const afterFresh = [
      { content: 'old', id: 'u1', role: 'user' },
      { content: 'old-a', id: 'a1', role: 'assistant' },
      { content: 'next', id: 'u4', role: 'user' },
      {
        content: 'fresh',
        id: 'a4',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant' as const,
      },
    ];
    expect(
      getEffectiveReportedInputTokenFloorAfterMessageId({
        cursorId: 'a1',
        messages: afterFresh,
        storedAfterMessageId: 'a1',
        topicMessages: afterFresh,
      }),
    ).toBe('a1');
    expect(
      getLatestReportedInputTokens(afterFresh, {
        afterMessageId: 'a1',
        lookupMessages: afterFresh,
      }),
    ).toBe(700_000);
  });

  it('accepts a post-compaction assistant after a user-only remaining window', () => {
    expect(getReportedInputTokenFloorBoundaryId([{ content: 'hi', id: 'u3', role: 'user' }])).toBe(
      'u3',
    );
    expect(
      getLatestReportedInputTokens(
        [
          { content: 'hi', id: 'u3', role: 'user' },
          {
            content: 'fresh',
            id: 'a3',
            metadata: { totalInputTokens: 700_000 },
            role: 'assistant',
          },
        ],
        { afterMessageId: 'u3' },
      ),
    ).toBe(700_000);
  });
});
