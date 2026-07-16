import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ToolMessageReorder } from '../ToolMessageReorder';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages,
  metadata: { model: 'gpt-4', maxTokens: 4096 },
  isAborted: false,
});

describe('ToolMessageReorder', () => {
  it('should place tool messages right after their assistant calls and drop invalid tools', async () => {
    const proc = new ToolMessageReorder();
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } },
        ],
      },
      { id: 't1', role: 'tool', content: '{"ok":1}', tool_call_id: 'call_1' },
      { id: 't_invalid', role: 'tool', content: '{"ok":0}' },
    ];

    const ctx = createContext(messages);
    const res = await proc.process(ctx);

    expect(res.messages.map((m) => m.id)).toEqual(['u1', 'a1', 't1']);
  });

  it('should reorderToolMessages', async () => {
    const proc = new ToolMessageReorder();
    const messages = [
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
            type: 'function',
          },
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'tool_call_nXxXHW8Z',
            type: 'function',
          },
        ],
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
      },
      {
        content: 'LobeHub 是一个专注于设计和开发现代人工智能生成内容（AIGC）工具和组件的团队。',
        role: 'assistant',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'tool_call_nXxXHW8Z',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'tool_call_2f3CEKz9',
      },
      {
        content: '### LobeHub 智能AI聚合神器\n\nLobeHub 是一个强大的AI聚合平台',
        role: 'assistant',
      },
    ];

    const ctx = createContext(messages);

    const output = await proc.process(ctx);

    expect(output.messages).toEqual([
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
            type: 'function',
          },
          {
            function: {
              arguments:
                '{"query":"LobeChat","searchEngines":["brave","google","duckduckgo","qwant"]}',
              name: 'lobe-web-browsing____searchWithSearXNG____builtin',
            },
            id: 'tool_call_nXxXHW8Z',
            type: 'function',
          },
        ],
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'call_6xCmrOtFOyBAcqpqO1TGfw2B',
      },
      {
        content: '[]',
        name: 'lobe-web-browsing____searchWithSearXNG____builtin',
        role: 'tool',
        tool_call_id: 'tool_call_nXxXHW8Z',
      },
      {
        content: 'LobeHub 是一个专注于设计和开发现代人工智能生成内容（AIGC）工具和组件的团队。',
        role: 'assistant',
      },
      {
        content: '### LobeHub 智能AI聚合神器\n\nLobeHub 是一个强大的AI聚合平台',
        role: 'assistant',
      },
    ]);
  });

  it('should drop orphan tool_calls from assistant message without matching tool response', async () => {
    // Regression: strict APIs (Moonshot/Kimi, OpenAI) reject requests where an
    // assistant message has tool_calls but one of the tool_call_ids is missing a
    // corresponding tool message response.
    const proc = new ToolMessageReorder();
    const messages = [
      { id: 'u1', role: 'user', content: 'search please' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'jina-mcp-server____search_web____mcp:7',
            type: 'function',
            function: { name: 'jina-mcp-server____search_web____mcp', arguments: '{}' },
          },
          {
            id: 'call_good',
            type: 'function',
            function: { name: 'jina-mcp-server____search_web____mcp', arguments: '{}' },
          },
        ],
      },
      { id: 't_good', role: 'tool', content: '{"ok":1}', tool_call_id: 'call_good' },
    ];

    const ctx = createContext(messages);
    const res = await proc.process(ctx);

    expect(res.messages.map((m) => m.id)).toEqual(['u1', 'a1', 't_good']);
    const assistant: any = res.messages.find((m) => m.id === 'a1');
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls[0].id).toBe('call_good');
  });

  it('should drop assistant message entirely when all tool_calls are orphans and content is empty', async () => {
    const proc = new ToolMessageReorder();
    const messages = [
      { id: 'u1', role: 'user', content: 'search please' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'orphan_1',
            type: 'function',
            function: { name: 'some_tool', arguments: '{}' },
          },
        ],
      },
      { id: 'u2', role: 'user', content: 'are you there?' },
    ];

    const ctx = createContext(messages);
    const res = await proc.process(ctx);

    expect(res.messages.map((m) => m.id)).toEqual(['u1', 'u2']);
  });

  it('should strip tool_calls but keep assistant message when content is present', async () => {
    const proc = new ToolMessageReorder();
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'partial answer before tool',
        tool_calls: [
          {
            id: 'orphan_1',
            type: 'function',
            function: { name: 'some_tool', arguments: '{}' },
          },
        ],
      },
      { id: 'u2', role: 'user', content: 'continue' },
    ];

    const ctx = createContext(messages);
    const res = await proc.process(ctx);

    expect(res.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
    const assistant: any = res.messages.find((m) => m.id === 'a1');
    expect(assistant.tool_calls).toBeUndefined();
    expect(assistant.content).toBe('partial answer before tool');
  });

  it('should reorder a tool message that appears before its assistant call (no duplication)', async () => {
    // Regression: a valid tool result that appears in the history BEFORE its
    // assistant call must be moved after that call and emitted exactly once.
    // The previous inline-emit logic duplicated it, breaking strict APIs.
    const messages = [
      {
        role: 'system',
        content: 'System message',
      },
      {
        role: 'tool',
        tool_call_id: 'tool_call_1',
        name: 'test-plugin____testApi',
        content: 'Tool result',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tool_call_1', type: 'function', function: { name: 'testApi', arguments: '{}' } },
        ],
      },
    ];

    const proc = new ToolMessageReorder();

    const ctx = createContext(messages);

    const { messages: output } = await proc.process(ctx);

    // Exactly one ordered assistant-call/result pair, no duplication.
    expect(output.length).toBe(3);
    expect(output[0].role).toBe('system');
    expect(output[1].role).toBe('assistant');
    expect(output[1].tool_calls[0].id).toBe('tool_call_1');
    expect(output[2].role).toBe('tool');
    expect(output[2].tool_call_id).toBe('tool_call_1');
  });

  it('should keep multiple parallel tool results in tool_call order after a single assistant call', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'run both' },
      // Tool results appear BEFORE the assistant call and in reverse order.
      { id: 't2', role: 'tool', tool_call_id: 'call_2', content: 'result-2' },
      { id: 't1', role: 'tool', tool_call_id: 'call_1', content: 'result-1' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'fn', arguments: '{}' } },
        ],
      },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((m: any) => m.id)).toEqual(['u1', 'a1', 't1', 't2']);
  });

  it('should not reorder when tool results already follow their assistant call', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
        ],
      },
      { id: 't1', role: 'tool', tool_call_id: 'call_1', content: 'result-1' },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((m: any) => m.id)).toEqual(['u1', 'a1', 't1']);
  });

  it('should drop a tool result whose assistant tool_call is genuinely missing', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      // Orphan result: no assistant message references 'ghost_call'.
      { id: 't_ghost', role: 'tool', tool_call_id: 'ghost_call', content: 'no caller' },
      { id: 'a1', role: 'assistant', content: 'done' },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((m: any) => m.id)).toEqual(['u1', 'a1']);
  });
});
