import { describe, expect, it } from 'vitest';

import {
  buildConversationGenerationLane,
  isActiveConversationGenerationStatus,
} from './conversationGeneration';

describe('buildConversationGenerationLane', () => {
  it('builds a session lane with inbox and main-thread defaults', () => {
    expect(
      buildConversationGenerationLane({
        userId: 'user-1',
      }),
    ).toBe('user-1:session:inbox:none:main');
  });

  it('includes session, topic, and thread ids', () => {
    expect(
      buildConversationGenerationLane({
        sessionId: 'sess-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:session:sess-1:topic-1:thread-1');
  });

  it('uses a group lane when groupId is present', () => {
    expect(
      buildConversationGenerationLane({
        groupId: 'group-1',
        sessionId: 'ignored-session',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:group:group-1:topic-1:main');
  });
});

describe('isActiveConversationGenerationStatus', () => {
  it('treats queued work as active', () => {
    expect(isActiveConversationGenerationStatus('pending')).toBe(true);
    expect(isActiveConversationGenerationStatus('processing')).toBe(true);
    expect(isActiveConversationGenerationStatus('cancelling')).toBe(true);
  });

  it('treats terminal work as inactive', () => {
    expect(isActiveConversationGenerationStatus('succeeded')).toBe(false);
    expect(isActiveConversationGenerationStatus('cancelled')).toBe(false);
    expect(isActiveConversationGenerationStatus('failed')).toBe(false);
  });
});
