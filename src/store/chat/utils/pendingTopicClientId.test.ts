import { describe, expect, it } from 'vitest';

import {
  buildPendingTopicClientIdKey,
  findPendingTopicClientId,
  isPendingUncreatedTopicId,
  shouldIgnoreEmptyFetchedMessages,
} from './pendingTopicClientId';

describe('pendingTopicClientId', () => {
  const pending = {
    [buildPendingTopicClientIdKey('current', 'session-1', 0)]: 'tpc_pending1',
  };

  it('finds a pending client topic id by value across fence keys', () => {
    expect(findPendingTopicClientId(pending, 'tpc_pending1')).toBe('tpc_pending1');
    expect(findPendingTopicClientId(pending, 'tpc_other')).toBeUndefined();
    expect(isPendingUncreatedTopicId(pending, 'tpc_pending1')).toBe(true);
  });

  it('ignores an empty fetch while send rows or an attached operation exist', () => {
    expect(
      shouldIgnoreEmptyFetchedMessages(
        {
          mainSendMessageOperations: { 'session-1_tpc_pending1': { isLoading: true } },
          pendingTopicClientIds: pending,
          serverGenerationOperations: {},
        },
        {
          incoming: [],
          mapKey: 'session-1_tpc_pending1',
          previous: [{ id: 'tmp_user' }, { id: 'tmp_assistant' }],
          topicId: 'tpc_pending1',
        },
      ),
    ).toBe(true);

    expect(
      shouldIgnoreEmptyFetchedMessages(
        {
          mainSendMessageOperations: {},
          pendingTopicClientIds: {},
          serverGenerationOperations: { 'session-1_topic': { cgo_one: { operationId: 'cgo_one' } } },
        },
        {
          incoming: [],
          mapKey: 'session-1_topic',
          previous: [{ id: 'msg_user' }],
          topicId: 'topic',
        },
      ),
    ).toBe(true);
  });

  it('applies a non-empty fetch and an empty fetch into an empty map', () => {
    expect(
      shouldIgnoreEmptyFetchedMessages(
        {
          mainSendMessageOperations: {},
          pendingTopicClientIds: {},
          serverGenerationOperations: {},
        },
        {
          incoming: [{ id: 'msg_user' }],
          mapKey: 'session-1_topic',
          previous: [{ id: 'tmp_user' }],
          topicId: 'topic',
        },
      ),
    ).toBe(false);

    expect(
      shouldIgnoreEmptyFetchedMessages(
        {
          mainSendMessageOperations: {},
          pendingTopicClientIds: {},
          serverGenerationOperations: {},
        },
        {
          incoming: [],
          mapKey: 'session-1_topic',
          previous: [],
          topicId: 'topic',
        },
      ),
    ).toBe(false);
  });
});
