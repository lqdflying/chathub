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
  it('returns content unchanged at or below the cap', () => {
    const content = 'x'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS);
    expect(truncateToolResultContent(content)).toBe(content);
  });

  it('caps oversized content with a deterministic omitted-chars marker', () => {
    const content = 'a'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 100);
    const truncated = truncateToolResultContent(content);

    expect(truncated).toBe(
      `${'a'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS)}\n…[truncated 100 chars]`,
    );
    // Deterministic: same input always yields the same bytes (prompt-cache stable).
    expect(truncateToolResultContent(content)).toBe(truncated);
  });

  it('honors a custom cap', () => {
    expect(truncateToolResultContent('abcdefgh', 4)).toBe('abcd\n…[truncated 4 chars]');
  });
});

describe('ToolResultTruncateProcessor', () => {
  it('caps only oversized tool-role messages and keeps pairs atomic', async () => {
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

    // No message is removed: the tool-call/tool-result pair stays intact.
    expect(result.messages).toHaveLength(5);

    const capped = result.messages[2];
    expect(capped.content).toBe(
      `${'t'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS)}\n…[truncated 50 chars]`,
    );
    expect(capped.tool_call_id).toBe('tc1');

    expect(result.messages[3].content).toBe('small result');
    expect(result.metadata.toolResultsTruncated).toBe(1);
  });

  it('is a pure per-message function: output depends on content, not position', async () => {
    const oversized = 'z'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 10);
    const processor = new ToolResultTruncateProcessor();

    const first = await processor.process(
      buildContext([{ id: 'tool1', content: oversized, role: 'tool', tool_call_id: 'tc1' }]),
    );
    const second = await processor.process(
      buildContext([
        { id: 'u1', content: 'later turn', role: 'user' },
        { id: 'tool1', content: oversized, role: 'tool', tool_call_id: 'tc1' },
      ]),
    );

    expect(second.messages[1].content).toBe(first.messages[0].content);
  });

  it('ignores non-string tool content and non-tool roles', async () => {
    const processor = new ToolResultTruncateProcessor();

    const result = await processor.process(
      buildContext([
        { id: 'tool1', content: [{ type: 'image_url' }], role: 'tool', tool_call_id: 'tc1' },
        { id: 'u1', content: 'x'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 500), role: 'user' },
      ]),
    );

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    expect(result.messages[1].content).toHaveLength(TOOL_RESULT_CONTENT_MAX_CHARS + 500);
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

  it('leaves MCP content unchanged and caps other tool rows', () => {
    const oversized = 'x'.repeat(TOOL_RESULT_CONTENT_MAX_CHARS + 20);
    expect(applyToolResultWireContent(oversized, { plugin: { type: 'mcp' } })).toBe(oversized);
    expect(applyToolResultWireContent(oversized, { plugin: { type: 'builtin' } })).toBe(
      truncateToolResultContent(oversized),
    );
  });
});
