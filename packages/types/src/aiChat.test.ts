import { describe, expect, it } from 'vitest';

import { AiCreateAssistantMessageSchema, AiSendMessageServerSchema } from './aiChat';

describe('AiSendMessageServerSchema', () => {
  const base = {
    newUserMessage: { content: 'hi' },
  };

  it('collapses JSON null threadId and topicId to the main conversation', () => {
    const parsed = AiSendMessageServerSchema.parse({
      ...base,
      threadId: null,
      topicId: null,
    });
    expect(parsed.threadId).toBeUndefined();
    expect(parsed.topicId).toBeUndefined();
  });

  it('accepts an adopted client topic id on newTopic', () => {
    const parsed = AiSendMessageServerSchema.parse({
      ...base,
      newTopic: {
        clientId: 'tpc_clientTopic1',
        id: 'tpc_clientTopic1',
        title: 'New Topic',
        topicMessageIds: [],
      },
    });
    expect(parsed.newTopic).toEqual({
      clientId: 'tpc_clientTopic1',
      id: 'tpc_clientTopic1',
      title: 'New Topic',
      topicMessageIds: [],
    });
  });
});

describe('AiCreateAssistantMessageSchema', () => {
  const base = {
    assistantMessageId: 'msg_1234567890ABCD',
    model: 'gpt-5-mini',
    parentId: 'msg_parent',
    provider: 'openai',
  };

  it('collapses JSON null threadId and topicId to the main conversation', () => {
    const parsed = AiCreateAssistantMessageSchema.parse({
      ...base,
      threadId: null,
      topicId: null,
    });
    expect(parsed.threadId).toBeUndefined();
    expect(parsed.topicId).toBeUndefined();
  });
});
