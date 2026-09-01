import { describe, expect, it } from 'vitest';

import { parseGenerateObjectToolCalls } from './parseGenerateObjectToolCalls';

describe('parseGenerateObjectToolCalls', () => {
  it('maps native tool_calls', () => {
    expect(
      parseGenerateObjectToolCalls({
        tool_calls: [
          { function: { arguments: '{"id":"agent-1"}', name: 'trigger_agent' }, type: 'function' },
        ],
      }),
    ).toEqual([{ arguments: { id: 'agent-1' }, name: 'trigger_agent' }]);
  });

  it('maps JSON-mode { tool_calls: [...] } content', () => {
    expect(
      parseGenerateObjectToolCalls({
        content: '{"tool_calls":[{"name":"trigger_agent","arguments":{"id":"agent-1"}}]}',
      }),
    ).toEqual([{ arguments: { id: 'agent-1' }, name: 'trigger_agent' }]);
  });

  it('treats an explicit empty tool_calls array as a structured no-op', () => {
    expect(parseGenerateObjectToolCalls({ content: '{"tool_calls":[]}' })).toEqual([]);
  });

  it('returns undefined for ordinary assistant text', () => {
    expect(parseGenerateObjectToolCalls({ content: 'I will wait for the user.' })).toBeUndefined();
  });

  it('returns undefined when there is no tool_calls and no content', () => {
    expect(parseGenerateObjectToolCalls({})).toBeUndefined();
  });

  it('returns undefined for JSON that is not a tool selection', () => {
    expect(parseGenerateObjectToolCalls({ content: '{"comment":"waiting"}' })).toBeUndefined();
  });
});
