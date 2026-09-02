import { describe, expect, it } from 'vitest';

import { extractJsonChatCompletionResult } from './extractJsonChatCompletion';

describe('extractJsonChatCompletionResult', () => {
  it('reads MiniMax Chat Completions hello text', () => {
    expect(
      extractJsonChatCompletionResult({
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: { content: 'Hello! How can I help you today?', role: 'assistant' },
          },
        ],
        object: 'chat.completion',
      }),
    ).toEqual({
      reasoning: '',
      text: 'Hello! How can I help you today?',
    });
  });

  it('reads reasoning_content when message content is empty', () => {
    expect(
      extractJsonChatCompletionResult({
        choices: [
          {
            message: { content: null, reasoning_content: 'trace', role: 'assistant' },
          },
        ],
      }),
    ).toEqual({
      reasoning: 'trace',
      text: '',
    });
  });

  it('joins multipart message content', () => {
    expect(
      extractJsonChatCompletionResult({
        choices: [
          {
            message: {
              content: [
                { text: 'Hello', type: 'text' },
                { text: ' world', type: 'text' },
              ],
              role: 'assistant',
            },
          },
        ],
      }).text,
    ).toBe('Hello world');
  });

  it('reads Responses API output_text', () => {
    expect(
      extractJsonChatCompletionResult({
        object: 'response',
        output_text: 'ok',
      }),
    ).toEqual({ reasoning: '', text: 'ok' });
  });

  it('returns empty for unrelated JSON', () => {
    expect(extractJsonChatCompletionResult({ some: 'data' })).toEqual({
      reasoning: '',
      text: '',
    });
  });
});
