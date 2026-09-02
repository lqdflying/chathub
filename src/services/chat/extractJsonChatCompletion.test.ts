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

  it('reads Responses API output_text when output is absent', () => {
    expect(
      extractJsonChatCompletionResult({
        object: 'response',
        output_text: 'ok',
      }),
    ).toEqual({ reasoning: '', text: 'ok' });
  });

  it('reads Responses API output_text once when output also contains the answer', () => {
    expect(
      extractJsonChatCompletionResult({
        object: 'response',
        output: [
          {
            content: [{ text: 'ok', type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
        output_text: 'ok',
      }),
    ).toEqual({ reasoning: '', text: 'ok' });
  });

  it('reads Responses API output[] when output_text is absent', () => {
    expect(
      extractJsonChatCompletionResult({
        object: 'response',
        output: [
          {
            content: [{ text: 'from-output', type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
      }).text,
    ).toBe('from-output');
  });

  it('reads Responses API reasoning independently of output_text', () => {
    expect(
      extractJsonChatCompletionResult({
        object: 'response',
        output: [
          { summary: [{ text: 'trace' }], type: 'reasoning' },
          {
            content: [{ text: 'ok', type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
        output_text: 'ok',
      }),
    ).toEqual({ reasoning: 'trace', text: 'ok' });
  });

  it('returns empty for unrelated JSON', () => {
    expect(extractJsonChatCompletionResult({ some: 'data' })).toEqual({
      reasoning: '',
      text: '',
    });
  });
});
