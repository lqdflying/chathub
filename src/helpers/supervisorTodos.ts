import type { UIChatMessage } from '@lobechat/types';

export interface SupervisorTodoItem {
  assignee?: string;
  content: string;
  finished: boolean;
}

export interface SupervisorDecision {
  id: string;
  instruction?: string;
  target?: string;
}

export const formatSupervisorTodoContent = (todos: SupervisorTodoItem[]): string =>
  JSON.stringify({
    timestamp: Date.now(),
    todos: todos || [],
    type: 'supervisor_todo',
  });

export const parseSupervisorTodosFromMessages = (messages: UIChatMessage[]): SupervisorTodoItem[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'supervisor' || !message.content) continue;
    try {
      const parsed = JSON.parse(message.content) as {
        todos?: SupervisorTodoItem[];
        type?: string;
      };
      if (parsed?.type === 'supervisor_todo' && Array.isArray(parsed.todos)) {
        return parsed.todos.map((todo) => ({
          assignee: typeof todo.assignee === 'string' ? todo.assignee : undefined,
          content: String(todo.content || ''),
          finished: Boolean(todo.finished),
        }));
      }
    } catch {
      continue;
    }
  }
  return [];
};

const isToolCallMessage = (message: UIChatMessage) =>
  message.role === 'assistant' && !!message.tools && message.tools.length > 0;

const countConsecutiveAssistantMessages = (messages: UIChatMessage[]) => {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') break;
    if (message.role === 'assistant') count += 1;
  }
  return count;
};

export const shouldAvoidSupervisorDecision = (
  messages: UIChatMessage[],
  maxResponseInRow?: number,
  isManualTrigger = false,
) => {
  if (messages.length === 0) return true;
  const lastMessage = messages.at(-1);
  if (!lastMessage) return true;
  if (isToolCallMessage(lastMessage) || lastMessage.role === 'tool') return true;
  if (!isManualTrigger && maxResponseInRow && maxResponseInRow > 0) {
    return countConsecutiveAssistantMessages(messages) >= maxResponseInRow;
  }
  return false;
};

const extractTodoData = (parameter: unknown): { assignee?: string; content: string | null } => {
  if (typeof parameter === 'string') {
    const trimmed = parameter.trim();
    return { content: trimmed || null };
  }
  if (!parameter || typeof parameter !== 'object') return { content: null };
  const payload = parameter as Record<string, unknown>;
  const candidates = [payload.content, payload.id, payload.title, payload.task, payload.text, payload.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const assignee = typeof payload.assignee === 'string' ? payload.assignee.trim() : undefined;
      return { assignee: assignee || undefined, content: candidate.trim() };
    }
  }
  return { content: null };
};

const applyCreateTodo = (targetTodos: SupervisorTodoItem[], parameter: unknown) => {
  if (!parameter || typeof parameter !== 'object') return false;
  const payload = parameter as Record<string, unknown>;
  const items = Array.isArray(payload.todos) ? payload.todos : [parameter];
  let hasChanged = false;
  for (const todoItem of items) {
    const { content, assignee } = extractTodoData(todoItem);
    if (!content) continue;
    const exists = targetTodos.some(
      (todo) => todo.content.trim().toLowerCase() === content.toLowerCase() && !todo.finished,
    );
    if (exists) continue;
    targetTodos.push({ content, finished: false, ...(assignee ? { assignee } : {}) });
    hasChanged = true;
  }
  return hasChanged;
};

const applyFinishTodo = (targetTodos: SupervisorTodoItem[], parameter: unknown) => {
  if (!parameter || typeof parameter !== 'object') return false;
  const payload = parameter as Record<string, unknown>;
  if (!Number.isInteger(payload.index)) return false;
  const index = payload.index as number;
  if (index < 0 || index >= targetTodos.length || targetTodos[index].finished) return false;
  targetTodos[index].finished = true;
  return true;
};

export const applySupervisorToolCalls = ({
  allowDM,
  availableAgentIds,
  previousTodos,
  scene,
  toolCalls,
}: {
  allowDM?: boolean;
  availableAgentIds: string[];
  previousTodos: SupervisorTodoItem[];
  scene?: 'casual' | 'productive';
  toolCalls: Array<{ arguments: Record<string, unknown>; name: string }>;
}): {
  decisions: SupervisorDecision[];
  todoUpdated: boolean;
  todos: SupervisorTodoItem[];
} => {
  const todos = previousTodos.map((todo) => ({ ...todo }));
  const decisions: SupervisorDecision[] = [];
  let todoUpdated = false;

  for (const call of toolCalls) {
    switch (call.name) {
      case 'create_todo': {
        if (scene === 'productive') todoUpdated = applyCreateTodo(todos, call.arguments) || todoUpdated;
        break;
      }
      case 'finish_todo': {
        if (scene === 'productive') todoUpdated = applyFinishTodo(todos, call.arguments) || todoUpdated;
        break;
      }
      case 'wait_for_user_input': {
        break;
      }
      case 'trigger_agent':
      case 'trigger_agent_dm': {
        const id =
          typeof call.arguments.id === 'string'
            ? call.arguments.id
            : typeof call.arguments.agentId === 'string'
              ? call.arguments.agentId
              : undefined;
        if (!id || !availableAgentIds.includes(id)) break;
        const requestedTarget =
          typeof call.arguments.target === 'string'
            ? call.arguments.target
            : call.name === 'trigger_agent_dm'
              ? 'user'
              : undefined;
        const target =
          allowDM === false ||
          (requestedTarget &&
            requestedTarget !== 'user' &&
            !availableAgentIds.includes(requestedTarget))
            ? undefined
            : requestedTarget;
        decisions.push({
          id,
          instruction:
            typeof call.arguments.instruction === 'string' ? call.arguments.instruction : undefined,
          target,
        });
        break;
      }
      default: {
        break;
      }
    }
  }

  return { decisions, todoUpdated, todos };
};
