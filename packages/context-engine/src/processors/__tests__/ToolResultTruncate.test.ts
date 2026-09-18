import { describe, expect, it } from 'vitest';

import {
  applyToolResultWireContent,
  isMcpToolResultMessage,
  TOOL_RESULT_CONTENT_MAX_CHARS,
  ToolResultTruncateProcessor,
  truncateToolResultContent,
} from '../ToolResultTruncate';

const buildContext = (messages: any[]) => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
    systemRole: '',
    tools: [],
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('truncateToolResultContent', () => {
  it('returns content unchanged at or below the historical page budget', () => {
    const content = 'x'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS);
    expect(truncateToolResultContent(content)).toBe(content);
  });

  it('still exposes the helper for memory-page tests', () => {
    const content = 'a'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 100);
    expect(truncateToolResultContent(content)).toBe(
      `${'a'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS)}\n…[truncated 100 chars]`,
    );
  });
});

describe('ToolResultTruncateProcessor', () => {
  it('does not rewrite tool results on the chat request', async () => {
    const oversized = 't'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 50);
    const processor = new ToolResultTruncateProcessor();

    const result = await processor.process(
      buildContext([
        { id: 'u1', content: 'question', role: 'user' },
        {
          id: 'a1',
          content: '',
          role: 'assistant',
          tools: [{ id: 'tc1', type: 'function' }],
        },
        { id: 'tool1', content: oversized, role: 'tool', tool_call_id: 'tc1' },
        { id: 'tool2', content: 'small result', role: 'tool', tool_call_id: 'tc2' },
        { id: 'a2', content: 'answer', role: 'assistant' },
      ]),
    );

    expect(result.messages).toHaveLength(5);
    expect(result.messages[2].content).toBe(oversized);
    expect(result.messages[3].content).toBe('small result');
    expect(result.metadata.toolResultsTruncated).toBe(0);
  });

  it('does not rewrite MCP tool results', async () => {
    const oversized = 'm'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 11364);
    const processor = new ToolResultTruncateProcessor();

    const result = await processor.process(
      buildContext([
        {
          id: 'tool1',
          content: oversized,
          plugin: { apiName: 'fetch', identifier: 'notion', type: 'mcp' },
          role: 'tool',
          tool_call_id: 'tc1',
        },
      ]),
    );

    expect(result.messages[0].content).toBe(oversized);
    expect(result.metadata.toolResultsTruncated).toBe(0);
  });
});

describe('isMcpToolResultMessage / applyToolResultWireContent', () => {
  it('detects MCP plugin type only', () => {
    expect(isMcpToolResultMessage({ plugin: { type: 'mcp' } })).toBe(true);
    expect(isMcpToolResultMessage({ plugin: { type: 'builtin' } })).toBe(false);
    expect(isMcpToolResultMessage({})).toBe(false);
  });

  it('sends the stored tool body to the model for every tool type', () => {
    const oversized = 'x'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 20);
    expect(applyToolResultWireContent(oversized, { plugin: { type: 'mcp' } })).toBe(oversized);
    expect(applyToolResultWireContent(oversized, { plugin: { type: 'builtin' } })).toBe(oversized);
  });
});
