import { describe, expect, it } from 'vitest';

import {
  parseGenerateObjectToolCalls,
  validateGenerateObjectToolCalls,
} from './parseGenerateObjectToolCalls';

const supervisorTools = [
  {
    function: {
      name: 'trigger_agent',
      parameters: {
        properties: { id: { type: 'string' }, instruction: { type: 'string' } },
        required: ['id', 'instruction'],
        type: 'object',
      },
    },
    type: 'function' as const,
  },
  {
    function: {
      name: 'wait_for_user_input',
      parameters: {
        properties: { reason: { type: 'string' } },
        required: [],
        type: 'object',
      },
    },
    type: 'function' as const,
  },
];

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

  it('parses an explicit empty tool_calls array as empty, not undefined', () => {
    expect(parseGenerateObjectToolCalls({ content: '{"tool_calls":[]}' })).toEqual([]);
  });

  it('returns undefined when a tool_calls entry has no name', () => {
    expect(parseGenerateObjectToolCalls({ content: '{"tool_calls":[{}]}' })).toBeUndefined();
  });

  it('returns undefined when one entry in a mixed list is malformed', () => {
    expect(
      parseGenerateObjectToolCalls({
        content: '{"tool_calls":[{"name":"trigger_agent","arguments":{"id":"a1"}},{}]}',
      }),
    ).toBeUndefined();
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

describe('validateGenerateObjectToolCalls', () => {
  it('rejects empty selections when tools were offered', () => {
    expect(validateGenerateObjectToolCalls([], supervisorTools)).toBeUndefined();
  });

  it('rejects invented names', () => {
    expect(
      validateGenerateObjectToolCalls([{ arguments: {}, name: 'invented' }], supervisorTools),
    ).toBeUndefined();
  });

  it('rejects missing required trigger_agent arguments', () => {
    expect(
      validateGenerateObjectToolCalls(
        [{ arguments: { id: 'a1' }, name: 'trigger_agent' }],
        supervisorTools,
      ),
    ).toBeUndefined();
  });

  it('rejects mixed valid and invalid calls', () => {
    expect(
      validateGenerateObjectToolCalls(
        [
          { arguments: { id: 'a1', instruction: 'Go' }, name: 'trigger_agent' },
          { arguments: {}, name: 'invented' },
        ],
        supervisorTools,
      ),
    ).toBeUndefined();
  });

  it('accepts wait_for_user_input', () => {
    expect(
      validateGenerateObjectToolCalls(
        [{ arguments: {}, name: 'wait_for_user_input' }],
        supervisorTools,
      ),
    ).toEqual([{ arguments: {}, name: 'wait_for_user_input' }]);
  });

  it('accepts trigger_agent with required fields', () => {
    expect(
      validateGenerateObjectToolCalls(
        [{ arguments: { id: 'a1', instruction: 'Go' }, name: 'trigger_agent' }],
        supervisorTools,
      ),
    ).toEqual([{ arguments: { id: 'a1', instruction: 'Go' }, name: 'trigger_agent' }]);
  });

  it('skips schema checks when the offered tool has no parameters', () => {
    expect(
      validateGenerateObjectToolCalls(
        [{ arguments: { id: 'a1' }, name: 'trigger_agent' }],
        [{ function: { name: 'trigger_agent' }, type: 'function' }],
      ),
    ).toEqual([{ arguments: { id: 'a1' }, name: 'trigger_agent' }]);
  });
});
