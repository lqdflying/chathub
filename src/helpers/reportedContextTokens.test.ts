import { describe, expect, it } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import {
  applyReportedInputTokenFloor,
  clearAnchorBaselines,
  fingerprintAnchorPrefix,
  getEffectiveReportedInputTokenFloorAfterMessageId,
  getLatestReportedInputAnchor,
  getLatestReportedInputTokenSourceId,
  getLatestReportedInputTokens,
  getReportedInputTokenFloorBoundaryId,
  messagesAfterId,
  nextReportedInputTokenFloorAfterMessageId,
  recordAnchorRequestWitness,
  resolveAnchorBaseline,
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

  describe('getLatestReportedInputAnchor', () => {
    it('returns the newest usage-reporting assistant with its id', () => {
      expect(
        getLatestReportedInputAnchor([
          { content: 'hi', id: 'u1', role: 'user' },
          { content: 'old', id: 'a1', metadata: { totalInputTokens: 100 }, role: 'assistant' },
          { content: 'next', id: 'u2', role: 'user' },
          { content: 'fresh', id: 'a2', metadata: { totalInputTokens: 200 }, role: 'assistant' },
        ]),
      ).toEqual({ id: 'a2', totalInputTokens: 200 });
    });

    it('skips usage-less assistants and respects the watermark window', () => {
      const messages = [
        { content: 'hi', id: 'u1', role: 'user' },
        { content: 'old', id: 'a1', metadata: { totalInputTokens: 100 }, role: 'assistant' },
        { content: 'next', id: 'u2', role: 'user' },
        { content: 'fresh', id: 'a2', role: 'assistant' },
      ];
      expect(getLatestReportedInputAnchor(messages)).toEqual({ id: 'a1', totalInputTokens: 100 });
      expect(getLatestReportedInputAnchor(messages, { afterMessageId: 'a1' })).toBeUndefined();
    });

    it('fail-closes to undefined when the watermark row is gone from the lookup', () => {
      expect(
        getLatestReportedInputAnchor(
          [{ content: 'fresh', id: 'a2', metadata: { totalInputTokens: 200 }, role: 'assistant' }],
          { afterMessageId: 'deleted' },
        ),
      ).toBeUndefined();
    });
  });

  describe('anchor request witnesses (D2/T1)', () => {
    const CONVERSATION = '[1,"session-1","topic-1"]';
    const OTHER_CONVERSATION = '[1,"session-1","topic-2"]';
    const messages = [
      { content: 'hi', id: 'u1', role: 'user' },
      { content: 'hello', id: 'a1', role: 'assistant' },
      { content: 'next', id: 'u2', role: 'user' },
    ];

    const recordWitness = (overrides: Partial<Parameters<typeof recordAnchorRequestWitness>[0]> = {}) =>
      recordAnchorRequestWitness({
        assistantMessageId: 'a2',
        conversationKey: CONVERSATION,
        fixedOverheadTokens: 100,
        messages,
        parentMessageId: 'u2',
        ...overrides,
      });

    const resolve = (overrides: Partial<Parameters<typeof resolveAnchorBaseline>[0]> = {}) =>
      resolveAnchorBaseline({
        anchorId: 'a2',
        anchorParentId: 'u2',
        conversationKey: CONVERSATION,
        currentFixedOverheadTokens: 100,
        prefixFingerprint: fingerprintAnchorPrefix(messages),
        reportedInputTokens: 1000,
        ...overrides,
      });

    it('promotes a matching dispatch witness exactly once', () => {
      clearAnchorBaselines();
      recordWitness();
      expect(resolve()?.overheadDelta).toBe(0);
      // Promoted to a baseline: the second resolve still trusts the anchor
      // (cached path), and a later overhead change lands as a delta.
      expect(resolve({ currentFixedOverheadTokens: 140 })?.overheadDelta).toBe(40);
    });

    it('never promotes without a dispatch witness (reload / cross-topic state)', () => {
      clearAnchorBaselines();
      expect(resolve()).toBeUndefined();
    });

    it('rejects a witness from another conversation', () => {
      clearAnchorBaselines();
      recordWitness();
      expect(resolve({ conversationKey: OTHER_CONVERSATION })).toBeUndefined();
      // …and the witness survives the foreign lookup, so returning to the
      // dispatch conversation can still promote it.
      expect(resolve()?.overheadDelta).toBe(0);
    });

    it('rejects a witness whose parent row differs', () => {
      clearAnchorBaselines();
      recordWitness();
      expect(resolve({ anchorParentId: 'u1' })).toBeUndefined();
    });

    it('rejects a witness when the prefix changed after dispatch', () => {
      clearAnchorBaselines();
      recordWitness();
      const edited = [
        messages[0],
        { ...messages[1], content: 'edited' },
        messages[2],
      ];
      expect(
        resolve({ prefixFingerprint: fingerprintAnchorPrefix(edited) }),
      ).toBeUndefined();
    });

    it('skips recording when the parent row is not visible', () => {
      clearAnchorBaselines();
      recordWitness({ parentMessageId: 'missing-parent' });
      expect(resolve()).toBeUndefined();
    });

    it('invalidates when selected pre-anchor history grows (U2)', () => {
      clearAnchorBaselines();
      recordWitness({ selectedPrefixIds: ['u2'] });
      expect(
        resolve({
          selectedPrefixIds: ['u1', 'a1', 'u2'],
        }),
      ).toBeUndefined();
    });

    it('keeps the witness when selected pre-anchor history only shrinks', () => {
      clearAnchorBaselines();
      recordWitness({ selectedPrefixIds: ['u1', 'a1', 'u2'] });
      expect(resolve({ selectedPrefixIds: ['u2'] })?.overheadDelta).toBe(0);
    });

    it('invalidates when the input template changes (U3)', () => {
      clearAnchorBaselines();
      recordWitness({ inputTemplate: '' });
      expect(resolve({ inputTemplate: 'x'.repeat(20_000) + '{{text}}' })).toBeUndefined();
    });

    it('keeps the witness when the input template is unchanged', () => {
      clearAnchorBaselines();
      recordWitness({ inputTemplate: 'Ask: {{text}}' });
      expect(resolve({ inputTemplate: 'Ask: {{text}}' })?.overheadDelta).toBe(0);
    });

    it('skips the template check when the caller omits inputTemplate', () => {
      clearAnchorBaselines();
      recordWitness({ inputTemplate: 'Ask: {{text}}' });
      expect(resolve()?.overheadDelta).toBe(0);
    });

    it('invalidates a promoted baseline when the input template later changes', () => {
      clearAnchorBaselines();
      recordWitness({ inputTemplate: '' });
      expect(resolve({ inputTemplate: '' })?.overheadDelta).toBe(0);
      expect(resolve({ inputTemplate: 'Ask: {{text}}' })).toBeUndefined();
    });

    it('a re-dispatch of the same row replaces the witness', () => {
      clearAnchorBaselines();
      recordWitness();
      const continued = [
        ...messages,
        { content: '...', id: 'a2', role: 'assistant' },
        { content: 'tool result', id: 't1', role: 'tool' },
      ];
      recordWitness({
        fixedOverheadTokens: 120,
        messages: continued,
        parentMessageId: 't1',
      });
      // The original request's witness is gone…
      expect(resolve()).toBeUndefined();
      // …and the continuation's witness promotes instead.
      expect(
        resolve({
          anchorParentId: 't1',
          currentFixedOverheadTokens: 120,
          prefixFingerprint: fingerprintAnchorPrefix(continued),
        })?.overheadDelta,
      ).toBe(0);
    });
  });
});
