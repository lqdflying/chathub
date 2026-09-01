import { describe, expect, it } from 'vitest';

import {
  ConversationGenerationConfigSchema,
  ConversationGenerationEnqueueSchema,
  buildConversationGenerationLane,
  getConversationGenerationLaneFamily,
  isActiveConversationGenerationStatus,
  isRetryableTerminalConversationGenerationStatus,
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

  it('isolates the supervisor from each group member', () => {
    expect(
      buildConversationGenerationLane({
        groupId: 'group-1',
        kind: 'group_supervisor',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:group:group-1:topic-1:main:chat:supervisor');
    expect(
      buildConversationGenerationLane({
        agentId: 'agent-a',
        groupId: 'group-1',
        kind: 'group_agent',
        targetId: 'user',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:group:group-1:topic-1:main:chat:agent:agent-a:user');
    expect(
      buildConversationGenerationLane({
        agentId: 'agent-b',
        groupId: 'group-1',
        kind: 'group_agent',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('user-1:group:group-1:topic-1:main:chat:agent:agent-b:default');
  });

  it('keeps chat retries on one family and isolates title and translation', () => {
    expect(getConversationGenerationLaneFamily('regenerate')).toBe('chat');
    expect(getConversationGenerationLaneFamily('group_supervisor')).toBe('chat');
    expect(getConversationGenerationLaneFamily('group_agent')).toBe('chat');
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
          expectedFingerprint: 'a'.repeat(64),
          expectedHistorySummary: 'existing summary',
          summarizerContextWindow: 8192,
          trigger: 'scheduled',
        },
        model: 'summary-model',
        provider: 'summary-provider',
        title: { force: true, topicId: 'topic-1' },
      }),
    ).toMatchObject({
      compaction: {
        candidateMessageIds: ['message-1', 'message-2'],
        summarizerContextWindow: 8192,
        trigger: 'scheduled',
      },
      title: { force: true, topicId: 'topic-1' },
    });
  });

  it('rejects an invalid snapshot summarizer window', () => {
    expect(() =>
      ConversationGenerationConfigSchema.parse({
        compaction: {
          candidateMessageIds: ['message-1'],
          expectedFingerprint: 'a'.repeat(64),
          expectedHistorySummary: '',
          summarizerContextWindow: 0,
          trigger: 'manual',
        },
        model: 'summary-model',
        provider: 'summary-provider',
      }),
    ).toThrow();
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

describe('isRetryableTerminalConversationGenerationStatus', () => {
  it('allows retry after failed, interrupted, or cancelled', () => {
    expect(isRetryableTerminalConversationGenerationStatus('failed')).toBe(true);
    expect(isRetryableTerminalConversationGenerationStatus('interrupted')).toBe(true);
    expect(isRetryableTerminalConversationGenerationStatus('cancelled')).toBe(true);
  });

  it('keeps succeeded and in-flight statuses non-retryable for the same key', () => {
    expect(isRetryableTerminalConversationGenerationStatus('succeeded')).toBe(false);
    expect(isRetryableTerminalConversationGenerationStatus('pending')).toBe(false);
    expect(isRetryableTerminalConversationGenerationStatus('processing')).toBe(false);
  });
});

describe('ConversationGenerationEnqueueSchema', () => {
  const base = {
    config: { model: 'gpt-5-mini', provider: 'openai' },
    kind: 'regenerate' as const,
  };

  it('accepts JSON null threadId and topicId for the main conversation', () => {
    expect(
      ConversationGenerationEnqueueSchema.parse({
        ...base,
        threadId: null,
        topicId: null,
      }),
    ).toMatchObject({ threadId: null, topicId: null });
  });

  it('still rejects a non-string threadId', () => {
    expect(
      ConversationGenerationEnqueueSchema.safeParse({
        ...base,
        threadId: 1,
      }).success,
    ).toBe(false);
  });
});
