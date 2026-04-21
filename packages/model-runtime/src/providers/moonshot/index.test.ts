// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { normalizeMessagesForMoonshot } from './index';

describe('normalizeMessagesForMoonshot', () => {
  it('keeps user / system / tool messages untouched', () => {
    const messages = [
      { content: 'hello', role: 'system' },
      { content: 'hi', role: 'user' },
      { content: 'tool result', role: 'tool', tool_call_id: 'abc' },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages)).toEqual(messages);
  });

  it('drops assistant messages with empty string content and no tool_calls', () => {
    // Reproduces the Moonshot error: "the message at position N with role
    // 'assistant' must not be empty". This happens when a prior stream
    // aborted or returned nothing and the empty bubble got persisted.
    const messages = [
      { content: 'hi', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '   ', role: 'assistant' },
      { content: 'are you there?', role: 'user' },
    ] as any;

    const result = normalizeMessagesForMoonshot(messages);

    expect(result).toEqual([
      { content: 'hi', role: 'user' },
      { content: 'are you there?', role: 'user' },
    ]);
  });

  it('drops assistant messages with empty array content and no tool_calls', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      { content: [], role: 'assistant' },
      { content: [{ text: '   ', type: 'text' }], role: 'assistant' },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages)).toEqual([{ content: 'hi', role: 'user' }]);
  });

  it('keeps assistant messages that carry tool_calls even when content is empty', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tool_calls: [{ function: { arguments: '{}', name: 'get_time' }, id: 't1', type: 'function' }],
      },
    ] as any;

    const result = normalizeMessagesForMoonshot(messages);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ role: 'assistant', tool_calls: expect.any(Array) });
  });

  it('maps reasoning onto reasoning_content for non-empty assistant messages', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      {
        content: 'answer',
        reasoning: { content: 'because...', duration: 10 },
        role: 'assistant',
      },
    ] as any;

    const [, assistant] = normalizeMessagesForMoonshot(messages);

    expect(assistant).toEqual({
      content: 'answer',
      reasoning_content: 'because...',
      role: 'assistant',
    });
  });

  it('forces reasoning_content to empty string when forceReasoning is true and reasoning is missing', () => {
    const messages = [
      { content: 'hi', role: 'user' },
      { content: 'answer', role: 'assistant' },
    ] as any;

    const [, assistant] = normalizeMessagesForMoonshot(messages, true);

    expect(assistant).toEqual({
      content: 'answer',
      reasoning_content: '',
      role: 'assistant',
    });
  });

  it('still drops empty assistant messages when forceReasoning is true', () => {
    // kimi-k2.5 / kimi-k2-thinking force reasoning_content. We should not
    // resurrect an empty turn just to attach a blank reasoning field.
    const messages = [
      { content: 'hi', role: 'user' },
      { content: '', role: 'assistant' },
    ] as any;

    expect(normalizeMessagesForMoonshot(messages, true)).toEqual([
      { content: 'hi', role: 'user' },
    ]);
  });
});
