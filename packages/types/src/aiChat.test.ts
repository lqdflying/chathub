import { describe, expect, it } from 'vitest';

import { AiCreateAssistantMessageSchema, AiSendMessageServerSchema } from './aiChat';

describe('AiSendMessageServerSchema', () => {
  const base = {
    newUserMessage: { content: 'hi' },
  };

  it('accepts JSON null threadId for the main conversation', () => {
    expect(
      AiSendMessageServerSchema.parse({
        ...base,
        threadId: null,
        topicId: null,
      }),
    ).toMatchObject({ threadId: null, topicId: null });
  });
});

describe('AiCreateAssistantMessageSchema', () => {
  const base = {
    assistantMessageId: 'msg_1234567890ABCD',
    model: 'gpt-5-mini',
    parentId: 'msg_parent',
    provider: 'openai',
  };

  it('accepts JSON null threadId for the main conversation', () => {
    expect(
      AiCreateAssistantMessageSchema.parse({
        ...base,
        threadId: null,
        topicId: null,
      }),
    ).toMatchObject({ threadId: null, topicId: null });
  });
});
