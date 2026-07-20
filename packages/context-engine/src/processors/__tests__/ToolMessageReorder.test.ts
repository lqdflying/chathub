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
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
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

  it('should preserve repeated tool call IDs across parent-scoped assistant turns', async () => {
    const repeatedToolCalls = [
      {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:7',
        type: 'function',
      },
      {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:8',
        type: 'function',
      },
    ];
    const messages = [
      { content: 'search first', id: 'u1', role: 'user' },
      { content: '', id: 'a1', role: 'assistant', tool_calls: repeatedToolCalls },
      {
        content: 'round-1-result-7',
        id: 't1-7',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: repeatedToolCalls[0].id,
      },
      {
        content: 'round-1-result-8',
        id: 't1-8',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: repeatedToolCalls[1].id,
      },
      { content: 'search again', id: 'u2', role: 'user' },
      { content: '', id: 'a2', role: 'assistant', tool_calls: repeatedToolCalls },
      {
        content: 'round-2-result-7',
        id: 't2-7',
        parentId: 'a2',
        role: 'tool',
        tool_call_id: repeatedToolCalls[0].id,
      },
      {
        content: 'round-2-result-8',
        id: 't2-8',
        parentId: 'a2',
        role: 'tool',
        tool_call_id: repeatedToolCalls[1].id,
      },
    ];

    const originalMessages = structuredClone(messages);
    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((message: any) => message.id)).toEqual([
      'u1',
      'a1',
      't1-7',
      't1-8',
      'u2',
      'a2',
      't2-7',
      't2-8',
    ]);
    expect(messages).toEqual(originalMessages);
  });

  it('should use parentId when repeated tool results are stored out of order', async () => {
    const repeatedToolCall = {
      function: { arguments: '{}', name: 'tavily_search' },
      id: 'tavily____tavily_search____mcp:7',
      type: 'function',
    };
    const messages = [
      {
        content: 'round-2-result',
        id: 't2',
        parentId: 'a2',
        role: 'tool',
        tool_call_id: repeatedToolCall.id,
      },
      { content: '', id: 'a1', role: 'assistant', tool_calls: [repeatedToolCall] },
      {
        content: 'round-1-result',
        id: 't1',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: repeatedToolCall.id,
      },
      { content: '', id: 'a2', role: 'assistant', tool_calls: [repeatedToolCall] },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((message: any) => message.id)).toEqual(['a1', 't1', 'a2', 't2']);
  });

  it('should consume distinct legacy results for repeated assistant occurrences', async () => {
    const repeatedToolCall = {
      function: { arguments: '{}', name: 'tavily_search' },
      id: 'tavily____tavily_search____mcp:7',
      type: 'function',
    };
    const messages = [
      { content: '', id: 'a1', role: 'assistant', tool_calls: [repeatedToolCall] },
      {
        content: 'legacy-result-1',
        id: 't1',
        role: 'tool',
        tool_call_id: repeatedToolCall.id,
      },
      { content: '', id: 'a2', role: 'assistant', tool_calls: [repeatedToolCall] },
      {
        content: 'legacy-result-2',
        id: 't2',
        role: 'tool',
        tool_call_id: repeatedToolCall.id,
      },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((message: any) => message.id)).toEqual(['a1', 't1', 'a2', 't2']);
  });

  it('should drop only the unmatched tool call from a later repeated occurrence', async () => {
    const repeatedToolCalls = [
      {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:7',
        type: 'function',
      },
      {
        function: { arguments: '{}', name: 'tavily_search' },
        id: 'tavily____tavily_search____mcp:8',
        type: 'function',
      },
    ];
    const messages = [
      { content: '', id: 'a1', role: 'assistant', tool_calls: repeatedToolCalls },
      {
        content: 'round-1-result-7',
        id: 't1-7',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: repeatedToolCalls[0].id,
      },
      {
        content: 'round-1-result-8',
        id: 't1-8',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: repeatedToolCalls[1].id,
      },
      { content: '', id: 'a2', role: 'assistant', tool_calls: repeatedToolCalls },
      {
        content: 'round-2-result-7',
        id: 't2-7',
        parentId: 'a2',
        role: 'tool',
        tool_call_id: repeatedToolCalls[0].id,
      },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((message: any) => message.id)).toEqual(['a1', 't1-7', 't1-8', 'a2', 't2-7']);
    expect(output[3].tool_calls).toEqual([repeatedToolCalls[0]]);
  });

  it.each([
    {
      content: '',
      expectedIds: ['u1'],
      expectedToolCalls: undefined,
      name: 'drops an empty assistant',
    },
    {
      content: 'partial answer',
      expectedIds: ['a1', 'u1'],
      expectedToolCalls: undefined,
      name: 'keeps assistant text without tool calls',
    },
  ])('should $name when all calls in one occurrence are missing', async (testCase) => {
    const messages = [
      {
        content: testCase.content,
        id: 'a1',
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{}', name: 'missing_tool' },
            id: 'missing-call',
            type: 'function',
          },
        ],
      },
      { content: 'continue', id: 'u1', role: 'user' },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((message: any) => message.id)).toEqual(testCase.expectedIds);
    expect(output.find((message: any) => message.id === 'a1')?.tool_calls).toBe(
      testCase.expectedToolCalls,
    );
  });

  it('should require distinct results for duplicate IDs within one assistant message', async () => {
    const duplicateToolCall = {
      function: { arguments: '{}', name: 'tavily_search' },
      id: 'tavily____tavily_search____mcp:7',
      type: 'function',
    };
    const messages = [
      {
        content: '',
        id: 'a1',
        role: 'assistant',
        tool_calls: [duplicateToolCall, { ...duplicateToolCall }],
      },
      {
        content: 'only-result',
        id: 't1',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: duplicateToolCall.id,
      },
    ];

    const proc = new ToolMessageReorder();
    const { messages: output } = await proc.process(createContext(messages));

    expect(output.map((message: any) => message.id)).toEqual(['a1', 't1']);
    expect(output[0].tool_calls).toHaveLength(1);
  });
});
