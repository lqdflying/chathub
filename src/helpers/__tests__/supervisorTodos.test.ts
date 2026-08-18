import { describe, expect, it } from 'vitest';

import {
  applySupervisorToolCalls,
  formatSupervisorTodoContent,
  parseSupervisorTodosFromMessages,
  shouldAvoidSupervisorDecision,
} from '../supervisorTodos';

describe('supervisorTodos helpers', () => {
  it('round-trips todos from the latest supervisor message', () => {
    const content = formatSupervisorTodoContent([
      { content: 'Draft outline', finished: false },
      { assignee: 'agent-1', content: 'Review', finished: true },
    ]);
    expect(
      parseSupervisorTodosFromMessages([
        { content: 'stale', id: 'old', role: 'supervisor' },
        { content, id: 'latest', role: 'supervisor' },
      ] as any),
    ).toEqual([
      { assignee: undefined, content: 'Draft outline', finished: false },
      { assignee: 'agent-1', content: 'Review', finished: true },
    ]);
  });

  it('applies productive todos and agent triggers', () => {
    const result = applySupervisorToolCalls({
      allowDM: true,
      availableAgentIds: ['agent-a', 'agent-b'],
      previousTodos: [],
      scene: 'productive',
      toolCalls: [
        { arguments: { todos: [{ content: 'Write summary' }] }, name: 'create_todo' },
        { arguments: { id: 'agent-a', instruction: 'Go' }, name: 'trigger_agent' },
        { arguments: { id: 'agent-b', target: 'user' }, name: 'trigger_agent_dm' },
      ],
    });

    expect(result.todoUpdated).toBe(true);
    expect(result.todos).toEqual([{ content: 'Write summary', finished: false }]);
    expect(result.decisions).toEqual([
      { id: 'agent-a', instruction: 'Go', target: undefined },
      { id: 'agent-b', instruction: undefined, target: 'user' },
    ]);
  });

  it('avoids follow-up rounds after the consecutive assistant cap', () => {
    expect(
      shouldAvoidSupervisorDecision(
        [
          { id: 'u', role: 'user' },
          { id: 'a1', role: 'assistant' },
          { id: 'a2', role: 'assistant' },
        ] as any,
        2,
        false,
      ),
    ).toBe(true);
    expect(
      shouldAvoidSupervisorDecision(
        [
          { id: 'u', role: 'user' },
          { id: 'a1', role: 'assistant' },
        ] as any,
        2,
        false,
      ),
    ).toBe(false);
  });
});
