import { imageUrlToBase64 } from '@lobechat/utils';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAIChatMessage } from '../../types';
import { parseDataUri } from '../../utils/uriParser';
import {
  convertImageUrlToFile,
  convertMessageContent,
  convertOpenAIMessages,
  convertOpenAIResponseInputs,
} from './openai';

// 模拟依赖
vi.mock('@lobechat/utils', () => ({
  imageUrlToBase64: vi.fn(),
}));
vi.mock('../../utils/uriParser');

describe('convertMessageContent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the same content if not image_url type', async () => {
    const content = { type: 'text', text: 'Hello' } as OpenAI.ChatCompletionContentPart;
    const result = await convertMessageContent(content);
    expect(result).toEqual(content);
  });

  it('should convert image URL to base64 when necessary', async () => {
    // 设置环境变量
    process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    const result = await convertMessageContent(content);

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,base64String' },
    });

    expect(parseDataUri).toHaveBeenCalledWith('https://example.com/image.jpg');
    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
  });

  it('should not convert image URL when not necessary', async () => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);
    expect(imageUrlToBase64).not.toHaveBeenCalled();
  });
});

describe('convertOpenAIMessages', () => {
  it('should convert string content messages', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ] as OpenAI.ChatCompletionMessageParam[];

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual(messages);
  });

  it('should preserve the cached prefix when parallel tool results extend a turn', async () => {
    const baseMessages: OpenAIChatMessage[] = [
      { content: 'Cached question', role: 'user' },
      { content: 'Cached answer', role: 'assistant' },
      { content: 'Search three sources', role: 'user' },
    ];
    const toolCalls = ['first', 'second', 'third'].map((name, index) => ({
      function: { arguments: '{}', name },
      id: `call-${index + 1}`,
      type: 'function' as const,
    }));
    const continuationMessages: OpenAIChatMessage[] = [
      ...baseMessages,
      { content: '', role: 'assistant', tool_calls: toolCalls },
      ...toolCalls.map((toolCall, index) => ({
        content: `Result ${index + 1}`,
        role: 'tool' as const,
        tool_call_id: toolCall.id,
      })),
    ];

    const chatPrefix = await convertOpenAIMessages(
      baseMessages as OpenAI.ChatCompletionMessageParam[],
      'openai',
    );
    const chatContinuation = await convertOpenAIMessages(
      continuationMessages as OpenAI.ChatCompletionMessageParam[],
      'openai',
    );
    const responsesPrefix = await convertOpenAIResponseInputs(baseMessages, 'openai');
    const responsesContinuation = await convertOpenAIResponseInputs(continuationMessages, 'openai');

    expect(chatContinuation.slice(0, chatPrefix.length)).toEqual(chatPrefix);
    expect(responsesContinuation.slice(0, responsesPrefix.length)).toEqual(responsesPrefix);
    expect(responsesContinuation.slice(responsesPrefix.length).map(({ type }) => type)).toEqual([
      'function_call',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
      'function_call_output',
    ]);
  });

  it('should convert array content messages', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ],
      },
    ] as OpenAI.ChatCompletionMessageParam[];

    vi.spyOn(Promise, 'all');
    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,base64String' },
          },
        ],
      },
    ]);

    expect(Promise.all).toHaveBeenCalledTimes(2); // 一次用于消息数组，一次用于内容数组

    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;
  });
  it('should convert array content messages', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ],
      },
    ] as OpenAI.ChatCompletionMessageParam[];

    vi.spyOn(Promise, 'all');
    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual(messages);

    expect(Promise.all).toHaveBeenCalledTimes(2); // 一次用于消息数组，一次用于内容数组
  });

  it('should map reasoning.content to reasoning_content for DeepSeek', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning', duration: 100 },
      },
      { role: 'user', content: 'Hi' },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello', reasoning_content: 'some reasoning' },
      { role: 'user', content: 'Hi' },
    ]);
    // Ensure reasoning object is removed but reasoning_content is mapped
    expect((result[0] as any).reasoning).toBeUndefined();
    expect((result[0] as any).reasoning_content).toBe('some reasoning');
  });

  it('should preserve reasoning_content field from messages (for DeepSeek compatibility)', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning_content: 'some reasoning content',
      },
      { role: 'user', content: 'Hi' },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello', reasoning_content: 'some reasoning content' },
      { role: 'user', content: 'Hi' },
    ]);
    // Ensure reasoning_content field is preserved
    expect((result[0] as any).reasoning_content).toBe('some reasoning content');
  });

  it('should filter out reasoning but preserve reasoning_content field', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning', duration: 100 },
        reasoning_content: 'some reasoning content',
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello', reasoning_content: 'some reasoning content' },
    ]);
    // Ensure reasoning object is removed but reasoning_content is preserved
    expect((result[0] as any).reasoning).toBeUndefined();
    expect((result[0] as any).reasoning_content).toBe('some reasoning content');
  });

  it('should strip reasoning_content for openaicompatible provider', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning', duration: 100 },
        reasoning_content: 'some reasoning content',
      },
    ] as any;

    const result = await convertOpenAIMessages(messages, 'openaicompatible');

    expect(result).toEqual([{ role: 'assistant', content: 'Hello' }]);
    expect((result[0] as any).reasoning).toBeUndefined();
    expect((result[0] as any).reasoning_content).toBeUndefined();
  });

  it('should preserve reasoning_content for deepseek provider', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning', duration: 100 },
      },
    ] as any;

    const result = await convertOpenAIMessages(messages, 'deepseek');

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello', reasoning_content: 'some reasoning' },
    ]);
    expect((result[0] as any).reasoning_content).toBe('some reasoning');
  });

  it('should preserve reasoning_content when no provider is passed (backward compat)', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning' },
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect((result[0] as any).reasoning_content).toBe('some reasoning');
  });

  it('should preserve null content and reasoning_content on tool-only assistant (Moonshot Kimi)', async () => {
    const messages = [
      {
        content: null,
        reasoning_content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{"q":1}', name: '$web_search' },
            id: 'call_1',
            type: 'function',
          },
        ],
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result[0]).toEqual({
      content: null,
      reasoning_content: '',
      role: 'assistant',
      tool_calls: messages[0].tool_calls,
    });
  });

  it('should preserve reasoning_details for MiniMax interleaved thinking', async () => {
    const reasoning_details = [
      {
        format: 'MiniMax-response-v1',
        id: 'reasoning-text-0',
        index: 0,
        text: 'thinking about it',
        type: 'reasoning.text',
      },
    ];
    const messages = [
      { content: '', reasoning_details, role: 'assistant' },
      { content: 'Hi', role: 'user' },
    ] as any;

    const result = await convertOpenAIMessages(messages, 'minimax');

    expect(result).toEqual([
      { content: '', reasoning_details, role: 'assistant' },
      { content: 'Hi', role: 'user' },
    ]);
    expect((result[0] as any).reasoning_details).toEqual(reasoning_details);
  });
});

describe('convertOpenAIResponseInputs', () => {
  it('应该正确转换普通文本消息', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('应该正确转换带有工具调用的消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'test_function',
              arguments: '{"key": "value"}',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        arguments: '{"key": "value"}',
        call_id: 'call_123',
        name: 'test_function',
        type: 'function_call',
      },
    ]);
  });

  it('应该正确转换工具响应消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'tool',
        content: 'Function result',
        tool_call_id: 'call_123',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        call_id: 'call_123',
        output: 'Function result',
        type: 'function_call_output',
      },
    ]);
  });

  it('应该正确转换包含图片的消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is an image' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/jpeg;base64,test123',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is an image' },
          {
            detail: 'auto',
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,test123',
          },
        ],
      },
    ]);
  });

  it('应该正确处理混合类型的消息序列', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'I need help with a function' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'get_data',
              arguments: '{}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"result": "success"}',
        tool_call_id: 'call_456',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { role: 'user', content: 'I need help with a function' },
      {
        arguments: '{}',
        call_id: 'call_456',
        name: 'get_data',
        type: 'function_call',
      },
      {
        call_id: 'call_456',
        output: '{"result": "success"}',
        type: 'function_call_output',
      },
    ]);
  });

  it('should extract reasoning.content into a separate reasoning item', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'system prompts', role: 'system' },
      { content: '你好', role: 'user' },
      {
        content: 'hello',
        role: 'assistant',
        reasoning: { content: 'reasoning content', duration: 2706 },
      },
      { content: '杭州天气如何', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { content: 'system prompts', role: 'developer' },
      { content: '你好', role: 'user' },
      { summary: [{ text: 'reasoning content', type: 'summary_text' }], type: 'reasoning' },
      { content: 'hello', role: 'assistant' },
      { content: '杭州天气如何', role: 'user' },
    ]);
  });

  it('should skip historical reasoning items for the openaicompatible provider', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'system prompts', role: 'system' },
      { content: '你好', role: 'user' },
      {
        content: 'hello',
        role: 'assistant',
        reasoning: { content: 'reasoning content', duration: 2706 },
        reasoning_content: 'legacy reasoning content',
      },
      { content: '杭州天气如何', role: 'user' },
    ] as any;

    const result = await convertOpenAIResponseInputs(messages, 'openaicompatible');

    expect(result).toEqual([
      { content: 'system prompts', role: 'developer' },
      { content: '你好', role: 'user' },
      { content: 'hello', role: 'assistant' },
      { content: '杭州天气如何', role: 'user' },
    ]);
    expect((result[2] as any).reasoning).toBeUndefined();
    expect((result[2] as any).reasoning_content).toBeUndefined();
  });

  it('should emit assistant text before function_call items (mixed content)', async () => {
    // Regression: an assistant turn with BOTH text commentary and tool_calls
    // previously dropped the text entirely. It must be emitted as a role-valid
    // assistant string message BEFORE the function_call items.
    const messages: OpenAIChatMessage[] = [
      {
        role: 'assistant',
        content: 'Let me search for that.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      } as any,
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { content: 'Let me search for that.', role: 'assistant' },
      {
        arguments: '{"q":"test"}',
        call_id: 'call_1',
        name: 'search',
        type: 'function_call',
      },
    ]);
  });

  it('should replay assistant content parts as ordered string content', async () => {
    // Responses accepts user input parts such as input_text/input_image, but
    // persisted assistant history must not be replayed as assistant input_text arrays.
    const messages: OpenAIChatMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'first part' },
          { type: 'text', text: ' second part' },
        ],
      } as any,
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        content: 'first part second part',
        role: 'assistant',
      },
    ]);
    expect((result[0] as any).content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'input_text' })]),
    );
  });

  it('should preserve a full user-assistant-user follow-up without assistant input_text parts', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Find news about Tavily MCP.' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I found the relevant details.' }],
      } as any,
      { role: 'user', content: 'Summarize the follow-up risk.' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { role: 'user', content: 'Find news about Tavily MCP.' },
      { role: 'assistant', content: 'I found the relevant details.' },
      { role: 'user', content: 'Summarize the follow-up risk.' },
    ]);
    expect(JSON.stringify(result)).not.toContain('"type":"input_text","role":"assistant"');
  });

  it('should preserve image detail when converting user image parts', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/img.png', detail: 'high' },
          },
        ],
      } as any,
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        content: [
          {
            type: 'input_image',
            image_url: 'https://example.com/img.png',
            detail: 'high',
          },
        ],
        role: 'user',
      },
    ]);
  });

  it('should not leak tool_calls or reasoning into user/system items', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'sys', role: 'system' } as any,
      {
        content: 'hi',
        role: 'user',
        // Stray fields that must NOT leak into the Responses easy-input item.
        tool_calls: [{ id: 'x', type: 'function', function: { name: 'x', arguments: '{}' } }],
        tool_call_id: 'stray',
        name: 'should-not-leak',
      } as any,
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { content: 'sys', role: 'developer' },
      { content: 'hi', role: 'user' },
    ]);
    expect((result[0] as any).tool_calls).toBeUndefined();
    expect((result[1] as any).tool_calls).toBeUndefined();
    expect((result[1] as any).reasoning).toBeUndefined();
  });

  it('should drop fully-empty textual items from the final Responses input', async () => {
    // Regression (P1): blank system turns renamed to `developer` by
    // `pruneReasoningPayload` (gpt-5-mini) and blank user turns used to
    // serialize as empty input messages, which strict Responses gateways
    // reject with a 400. The final representation must contain no empty
    // textual items.
    const messages: OpenAIChatMessage[] = [
      { content: '', role: 'developer' } as any,
      { content: '   ', role: 'user' },
      { content: '', role: 'assistant' },
      { content: 'hi', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([{ content: 'hi', role: 'user' }]);
  });

  it('should drop a reasoning-only assistant whose reasoning is not serialized (openaicompatible)', async () => {
    // Regression (P1): the pre-conversion filter keeps a reasoning-only
    // assistant turn, but `openaicompatible` intentionally strips historical
    // reasoning — the turn would serialize as an empty assistant message.
    const messages: OpenAIChatMessage[] = [
      { content: 'q', role: 'user' },
      { content: '', reasoning: { content: 'thinking' }, role: 'assistant' },
      { content: 'next', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages, 'openaicompatible');

    expect(result).toEqual([
      { content: 'q', role: 'user' },
      { content: 'next', role: 'user' },
    ]);
  });

  it('should keep the reasoning item and drop the empty assistant shell for reasoning-serializing providers', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'q', role: 'user' },
      { content: '', reasoning: { content: 'thinking' }, role: 'assistant' },
      { content: 'next', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages, 'openai');

    expect(result).toEqual([
      { content: 'q', role: 'user' },
      { summary: [{ text: 'thinking', type: 'summary_text' }], type: 'reasoning' },
      { content: 'next', role: 'user' },
    ]);
  });

  it('should translate legacy function_call/function pairs into paired Responses items', async () => {
    // Regression: legacy Chat Completions function calling used to fall
    // through to an empty assistant item plus a user item, losing the
    // call/result relationship and tripping empty-message validation.
    const messages: OpenAIChatMessage[] = [
      { content: 'q', role: 'user' },
      {
        content: '',
        function_call: { arguments: '{"city":"SF"}', name: 'get_weather' },
        role: 'assistant',
      } as any,
      { content: 'sunny', name: 'get_weather', role: 'function' } as any,
      { content: 'next', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ content: 'q', role: 'user' });
    expect(result[1]).toMatchObject({
      arguments: '{"city":"SF"}',
      name: 'get_weather',
      type: 'function_call',
    });
    const callId = (result[1] as any).call_id;
    expect(typeof callId).toBe('string');
    expect(callId.length).toBeGreaterThan(0);
    expect(result[2]).toEqual({ call_id: callId, output: 'sunny', type: 'function_call_output' });
    expect(result[3]).toEqual({ content: 'next', role: 'user' });
    // No empty textual items may survive the conversion.
    for (const item of result) {
      const record = item as Record<string, unknown>;
      if (record.type === undefined) {
        expect(typeof record.content === 'string' && record.content.trim().length > 0).toBe(true);
      }
    }
  });

  it('should preserve assistant text before a legacy function_call item', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        content: 'Let me check the weather.',
        function_call: { arguments: '{}', name: 'get_weather' },
        role: 'assistant',
      } as any,
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { content: 'Let me check the weather.', role: 'assistant' },
      {
        arguments: '{}',
        call_id: (result[1] as any).call_id,
        name: 'get_weather',
        type: 'function_call',
      },
    ]);
  });

  it('should emit deterministic legacy call ids for the same message sequence', async () => {
    // Prompt-cache prefixes must stay stable across identical replays.
    const messages: OpenAIChatMessage[] = [
      { content: 'q', role: 'user' },
      {
        content: '',
        function_call: { arguments: '{}', name: 'a' },
        role: 'assistant',
      } as any,
      { content: 'r1', role: 'function' } as any,
      {
        content: '',
        function_call: { arguments: '{}', name: 'b' },
        role: 'assistant',
      } as any,
      { content: 'r2', role: 'function' } as any,
    ];

    const first = await convertOpenAIResponseInputs(messages);
    const second = await convertOpenAIResponseInputs(messages);

    expect(second).toEqual(first);
    const callIds = first
      .filter((item) => (item as any).type === 'function_call')
      .map((item) => (item as any).call_id);
    expect(callIds).toHaveLength(2);
    expect(new Set(callIds).size).toBe(2);
    // Outputs pair with the nearest preceding legacy call, in order.
    const outputs = first
      .filter((item) => (item as any).type === 'function_call_output')
      .map((item) => (item as any).call_id);
    expect(outputs).toEqual(callIds);
  });

  it('should never drop function_call_output items even with empty output', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'noop', arguments: '{}' } },
        ],
        role: 'assistant',
      },
      { content: '', role: 'tool', tool_call_id: 'call_1' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { arguments: '{}', call_id: 'call_1', name: 'noop', type: 'function_call' },
      { call_id: 'call_1', output: '', type: 'function_call_output' },
    ]);
  });
});

describe('convertImageUrlToFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Data URL handling', () => {
    it('should convert PNG data URL to File object correctly', async () => {
      const base64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.png');
      expect(result).toHaveProperty('type', 'image/png');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should convert JPEG data URL to File object correctly', async () => {
      const base64Data =
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA9BQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      const dataUrl = `data:image/jpeg;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.jpeg');
      expect(result).toHaveProperty('type', 'image/jpeg');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should convert WebP data URL to File object correctly', async () => {
      const base64Data = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAAAAJaQAA6g=';
      const dataUrl = `data:image/webp;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.webp');
      expect(result).toHaveProperty('type', 'image/webp');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('HTTP URL handling', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      // Mock global fetch using vi.stubGlobal for better isolation
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it('should convert HTTP URL to File object correctly', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockHeaders = new Headers();
      mockHeaders.set('content-type', 'image/jpeg');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: mockHeaders,
      } satisfies Partial<Response>);

      const result = await convertImageUrlToFile('https://example.com/image.jpg');

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.jpeg');
      expect(result).toHaveProperty('type', 'image/jpeg');
      expect(result).toHaveProperty('size');
      expect(result.size).toEqual(8);
    });

    it('should handle different content types from HTTP response headers', async () => {
      const testCases = [
        { contentType: 'image/jpeg', expectedExtension: 'jpeg' },
        { contentType: 'image/png', expectedExtension: 'png' },
        { contentType: 'image/webp', expectedExtension: 'webp' },
        { contentType: null, expectedExtension: 'png' }, // default fallback
      ];

      for (const testCase of testCases) {
        const mockArrayBuffer = new ArrayBuffer(8);
        const mockHeaders = new Headers();
        if (testCase.contentType) {
          mockHeaders.set('content-type', testCase.contentType);
        }

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          headers: mockHeaders,
        } satisfies Partial<Response>);

        const result = await convertImageUrlToFile('https://example.com/image.jpg');

        expect(result).toHaveProperty('name', `image.${testCase.expectedExtension}`);
        expect(result).toHaveProperty('type', testCase.contentType || 'image/png');

        vi.clearAllMocks();
      }
    });

    it('should throw error when HTTP request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } satisfies Partial<Response>);

      await expect(convertImageUrlToFile('https://example.com/nonexistent.jpg')).rejects.toThrow(
        'Failed to fetch image from https://example.com/nonexistent.jpg: Not Found',
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/nonexistent.jpg');
    });

    it('should throw error when network request fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(convertImageUrlToFile('https://example.com/image.jpg')).rejects.toThrow(
        'Network error',
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed data URL gracefully', async () => {
      const malformedDataUrl = 'data:invalid-format';

      // 这个测试可能会抛出错误，我们需要适当处理
      await expect(convertImageUrlToFile(malformedDataUrl)).rejects.toThrow();
    });
  });
});
