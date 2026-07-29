import { describe, expect, it } from 'vitest';

import { messageMapKey, parseMessageMapKey } from './messageMapKey';

describe('messageMapKey', () => {
  it.each([
    {
      sessionId: 'ssn_KbcUulFch0XW',
      topicId: 'tpc_sFEpZTp0eROJ',
    },
    {
      sessionId: 'ssn_inbox_user_with_underscores',
      topicId: 'tpc_topic_with_underscores',
    },
    {
      sessionId: 'ssn_without_topic',
      topicId: null,
    },
  ])('round trips $sessionId and $topicId', ({ sessionId, topicId }) => {
    const mapKey = messageMapKey(sessionId, topicId);

    expect(parseMessageMapKey(mapKey)).toEqual({
      sessionId,
      topicId,
    });
  });

  it('normalizes an undefined topic to null', () => {
    const mapKey = messageMapKey('ssn_session');

    expect(parseMessageMapKey(mapKey)).toEqual({
      sessionId: 'ssn_session',
      topicId: null,
    });
  });

  it.each([
    'ssn_session_tpc_topic',
    JSON.stringify([2, 'ssn_session', 'tpc_topic']),
    JSON.stringify([1, 123, 'tpc_topic']),
    JSON.stringify([1, 'ssn_session', 123]),
    JSON.stringify([1, 'ssn_session']),
    JSON.stringify({ sessionId: 'ssn_session', topicId: 'tpc_topic' }),
  ])('rejects malformed key %s', (mapKey) => {
    expect(parseMessageMapKey(mapKey)).toBeUndefined();
  });
});
