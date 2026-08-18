import { describe, expect, it } from 'vitest';

import {
  ConversationGenerationConfigSchema,
  buildConversationGenerationLane,
  getConversationGenerationLaneFamily,
  isActiveConversationGenerationStatus,
} from './conversationGeneration';

describe('buildConversationGenerationLane', () => {
  it('builds a session lane with inbox, main-thread, and chat-family defaults', () => {
    expect(
      buildConversationGenerationLane({
        userId: 'user-1',
      }),
    ).toBe('user-1:session:inbox:none:main:chat');
  });

  it('includes session, topic, and thread ids', () => {
    expect(
      buildConversationGenerationLane({
        sessionId: 'sess-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:session:sess-1:topic-1:thread-1:chat');
  });

  it('uses a group lane when groupId is present', () => {
    expect(
      buildConversationGenerationLane({
        groupId: 'group-1',
        sessionId: 'ignored-session',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:group:group-1:topic-1:main:chat');
  });

  it('keeps chat retries on one family and isolates title and translation', () => {
    expect(getConversationGenerationLaneFamily('regenerate')).toBe('chat');
    expect(getConversationGenerationLaneFamily('group_supervisor')).toBe('chat');
    expect(
      buildConversationGenerationLane({
        kind: 'topic_title',
        sessionId: 'sess-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:session:sess-1:topic-1:main:topic_title');
    expect(
      buildConversationGenerationLane({
        kind: 'translation',
        sessionId: 'sess-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:session:sess-1:topic-1:main:translation');
  });
});

describe('ConversationGenerationConfigSchema', () => {
  it('accepts durable title intent and a guarded compaction plan', () => {
    expect(
      ConversationGenerationConfigSchema.parse({
        compaction: {
          candidateMessageIds: ['message-1', 'message-2'],
          expectedFingerprint: 'fingerprint',
          expectedHistorySummary: 'existing summary',
          trigger: 'scheduled',
        },
        model: 'summary-model',
        provider: 'summary-provider',
        title: { force: true, topicId: 'topic-1' },
      }),
    ).toMatchObject({
      compaction: {
        candidateMessageIds: ['message-1', 'message-2'],
        trigger: 'scheduled',
      },
      title: { force: true, topicId: 'topic-1' },
    });
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
