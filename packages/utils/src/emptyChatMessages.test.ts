import { describe, expect, it } from 'vitest';

import { dropFullyEmptyMessages } from './emptyChatMessages';

describe('dropFullyEmptyMessages', () => {
  it('drops user/assistant/system messages with empty string content', () => {
    const messages = [
      { content: '  ', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '', role: 'system' },
      { content: 'hello', role: 'user' },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual([{ content: 'hello', role: 'user' }]);
  });

  it('drops empty developer messages (o-series / gpt-5 system rename)', () => {
    const messages = [
      { content: '', role: 'developer' },
      { content: '   ', role: 'developer' },
      { content: 'real instructions', role: 'developer' },
      { content: 'hi', role: 'user' },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual([
      { content: 'real instructions', role: 'developer' },
      { content: 'hi', role: 'user' },
    ]);
  });

  it('keeps messages with non-empty string content', () => {
    const messages = [
      { content: 'a question', role: 'user' },
      { content: 'an answer', role: 'assistant' },
      { content: 'system prompt', role: 'system' },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('keeps assistant messages that carry tool_calls even with empty content', () => {
    const messages = [
      {
        content: '',
        role: 'assistant',
        tool_calls: [{ function: { arguments: '{}', name: 'search' }, id: 'call_1' }],
      },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('keeps assistant messages that carry a legacy function_call', () => {
    const messages = [
      {
        content: '',
        function_call: { arguments: '{}', name: 'get_weather' },
        role: 'assistant',
      },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('keeps reasoning-only assistant turns (MiniMax interleaved thinking)', () => {
    const messages = [
      {
        content: '',
        reasoning: { content: 'thinking about the answer' },
        role: 'assistant',
      },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('keeps assistant turns carrying reasoning_content or reasoning_details', () => {
    const messages = [
      { content: '', reasoning_content: 'deep thought', role: 'assistant' },
      {
        content: '',
        reasoning_details: [
          { format: 'MiniMax-response-v1', text: 'thought', type: 'reasoning.text' },
        ],
        role: 'assistant',
      },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('drops assistant turns whose reasoning is blank', () => {
    const messages = [
      { content: '', reasoning: { content: '   ' }, role: 'assistant' },
      { content: '', reasoning_content: '', role: 'assistant' },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual([]);
  });

  it('never drops tool messages', () => {
    const messages = [{ content: '', role: 'tool', tool_call_id: 'call_1' }];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('never drops legacy function result messages', () => {
    const messages = [{ content: '', name: 'get_weather', role: 'function' }];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('drops messages whose content is an empty array', () => {
    const messages = [{ content: [], role: 'user' }];

    expect(dropFullyEmptyMessages(messages)).toEqual([]);
  });

  it('drops array content that only has blank text parts', () => {
    const messages = [{ content: [{ text: '   ', type: 'text' }], role: 'user' }];

    expect(dropFullyEmptyMessages(messages)).toEqual([]);
  });

  it('keeps array content with a non-blank text part', () => {
    const messages = [{ content: [{ text: 'hi', type: 'text' }], role: 'user' }];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('keeps array content with non-text parts (image_url)', () => {
    const messages = [
      {
        content: [{ image_url: { url: 'https://example.com/a.png' }, type: 'image_url' }],
        role: 'user',
      },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual(messages);
  });

  it('keeps messages with null or undefined content only for non-droppable roles', () => {
    const messages = [
      { content: null, role: 'user' },
      { role: 'assistant' },
      { content: null, role: 'tool', tool_call_id: 'call_1' },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual([
      { content: null, role: 'tool', tool_call_id: 'call_1' },
    ]);
  });

  it('returns the same order for surviving messages', () => {
    const messages = [
      { content: 'first', role: 'user' },
      { content: '', role: 'assistant' },
      { content: 'second', role: 'user' },
    ];

    expect(dropFullyEmptyMessages(messages)).toEqual([
      { content: 'first', role: 'user' },
      { content: 'second', role: 'user' },
    ]);
  });
});
