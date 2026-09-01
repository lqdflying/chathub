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
