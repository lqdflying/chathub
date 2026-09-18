import { getSlicedMessages } from '@lobechat/context-engine';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAnchorBaselines,
  fingerprintAnchorPrefix,
  resolveAnchorBaseline,
  resolveSelectedPreAnchorIds,
} from '@/helpers/reportedContextTokens';
import { commitAnchorDispatchWitness } from '@/store/chat/helpers/recordAnchorDispatchWitness';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const SESSION = 'session-1';
const TOPIC = 'topic-1';

const chatStateFor = (messages: Array<{ content: string; id: string; role: string }>) =>
  ({
    messagesMap: {
      [messageMapKey(SESSION, TOPIC)]: messages,
    },
  }) as any;

const prefixOf = (messages: Array<{ content: string; id: string; role: string }>) =>
  messages.slice(0, -1);

const resolveAfterCommit = ({
  messages,
  selectedMessages,
}: {
  messages: Array<{ content: string; id: string; role: string }>;
  selectedMessages: Array<{ content: string; id: string; role: string }>;
}) => {
  const prefix = prefixOf(messages);
  return resolveAnchorBaseline({
    anchorId: 'new-a',
    anchorParentId: 'new-u',
    conversationKey: messageMapKey(SESSION, TOPIC),
    currentFixedOverheadTokens: 0,
    prefixFingerprint: fingerprintAnchorPrefix(prefix),
    reportedInputTokens: 1000,
    selectedPrefixIds: resolveSelectedPreAnchorIds({
      prefixMessages: prefix,
      selectedMessages,
    }),
  });
};

describe('commitAnchorDispatchWitness', () => {
  const messages = [
    { content: 'x'.repeat(20_000), id: 'old-u', role: 'user' },
    { content: 'old answer', id: 'old-a', role: 'assistant' },
    { content: 'hi', id: 'new-u', role: 'user' },
    { content: '…', id: 'new-a', role: 'assistant' },
  ];

  beforeEach(() => {
    clearAnchorBaselines();
  });

  const commit = (historyCount: number) =>
    commitAnchorDispatchWitness({
      assistantMessageId: 'new-a',
      chatState: chatStateFor(messages),
      conversation: { sessionId: SESSION, topicId: TOPIC },
      evidence: {
        enableHistoryCount: true,
        fixedOverheadTokens: 0,
        historyCount,
        inputTemplate: '',
      },
      parentMessageId: 'new-u',
    });

  it('U2: a zero history limit records an empty selection so widening falls back', () => {
    expect(
      getSlicedMessages(prefixOf(messages), { enableHistoryCount: true, historyCount: 0 }),
    ).toEqual([]);

    commit(0);

    const widened = getSlicedMessages(messages, {
      enableHistoryCount: true,
      historyCount: 20,
    });
    expect(resolveAfterCommit({ messages, selectedMessages: widened })).toBeUndefined();
  });

  it('U2: a negative history limit also records an empty selection', () => {
    expect(
      getSlicedMessages(prefixOf(messages), { enableHistoryCount: true, historyCount: -3 }),
    ).toEqual([]);

    commit(-3);

    const widened = getSlicedMessages(messages, {
      enableHistoryCount: true,
      historyCount: 20,
    });
    expect(resolveAfterCommit({ messages, selectedMessages: widened })).toBeUndefined();
  });

  it('U2: a positive history limit still certifies only the last N rows', () => {
    commit(2);

    // Same after-cursor slice the helper records: last N of the full list,
    // then intersected with the pre-anchor prefix (`new-u` only here).
    const selected = messages.slice(-2);
    expect(resolveAfterCommit({ messages, selectedMessages: selected })?.overheadDelta).toBe(0);
  });
});
