export type GenerateObjectToolCall = { arguments: Record<string, unknown>; name: string };

export type GenerateObjectOfferedTool = {
  function?: {
    name?: string;
    parameters?: {
      properties?: Record<string, { type?: unknown }>;
      required?: unknown;
    };
  };
};

const parseJsonValue = (value: string): unknown => {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed);
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parseToolCallArguments = (raw: unknown): Record<string, unknown> => {
  if (typeof raw === 'string') {
    const parsed = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  }
  return asRecord(raw) ?? {};
};

const mapOneNamedToolCall = (item: unknown): GenerateObjectToolCall | undefined => {
  const record = asRecord(item);
  if (!record) return undefined;
  const fn = asRecord(record.function);
  const name =
    typeof record.name === 'string'
      ? record.name
      : typeof record.tool_name === 'string'
        ? record.tool_name
        : typeof fn?.name === 'string'
          ? fn.name
          : undefined;
  if (!name) return undefined;
  return {
    arguments: parseToolCallArguments(record.arguments ?? record.parameter ?? fn?.arguments),
    name,
  };
};

const mapNamedToolCalls = (items: unknown[]): GenerateObjectToolCall[] | undefined => {
  const mapped: GenerateObjectToolCall[] = [];
  for (const item of items) {
    const parsed = mapOneNamedToolCall(item);
    if (!parsed) return undefined;
    mapped.push(parsed);
  }
  return mapped;
};

const jsonTypes = (type: unknown): string[] => {
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === 'string');
  return [];
};

const valueMatchesJsonType = (value: unknown, type: unknown): boolean => {
  const types = jsonTypes(type);
  if (types.length === 0) return true;
  return types.some((item) => {
    switch (item) {
      case 'string': {
        return typeof value === 'string';
      }
      case 'number': {
        return typeof value === 'number' && Number.isFinite(value);
      }
      case 'integer': {
        return typeof value === 'number' && Number.isInteger(value);
      }
      case 'boolean': {
        return typeof value === 'boolean';
      }
      case 'object': {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      }
      case 'array': {
        return Array.isArray(value);
      }
      case 'null': {
        return value === null;
      }
      default: {
        return true;
      }
    }
  });
};

type OfferedToolParameters = NonNullable<GenerateObjectOfferedTool['function']>['parameters'];

const argumentsMatchSchema = (
  args: Record<string, unknown>,
  parameters: OfferedToolParameters,
): boolean => {
  if (!parameters || typeof parameters !== 'object') return true;
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((key): key is string => typeof key === 'string')
    : [];
  const properties = asRecord(parameters.properties) ?? {};
  for (const key of required) {
    if (!Object.hasOwn(args, key) || args[key] === undefined || args[key] === null) {
      return false;
    }
    const property = asRecord(properties[key]);
    if (!valueMatchesJsonType(args[key], property?.type)) return false;
  }
  return true;
};

/**
 * Parse OpenAI-style `tool_calls` or JSON-mode content that encodes the same
 * selection (`{ tool_calls: [...] }`, an array of `{ name, arguments }`, or a
 * single named object). Used when a provider cannot force `tool_choice`.
 * Malformed entries fail the whole parse instead of being dropped.
 */
export const parseGenerateObjectToolCalls = (message: {
  content?: unknown;
  tool_calls?: unknown;
}): GenerateObjectToolCall[] | undefined => {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    try {
      return mapNamedToolCalls(message.tool_calls);
    } catch {
      return undefined;
    }
  }

  if (typeof message.content !== 'string' || !message.content.trim()) return undefined;

  try {
    const parsed = parseJsonValue(message.content);
    if (Array.isArray(parsed)) return mapNamedToolCalls(parsed);
    const record = asRecord(parsed);
    if (!record) return undefined;
    if (Array.isArray(record.tool_calls)) return mapNamedToolCalls(record.tool_calls);
    if (typeof record.name === 'string' || typeof record.tool_name === 'string') {
      return mapNamedToolCalls([record]);
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Xiaomi JSON mode guarantees syntax only, not schema compliance
 * (https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output).
 * Reject empty, unknown, or required-argument-invalid selections before callers
 * treat them as a successful no-op. `wait_for_user_input` is a valid pause.
 */
export const validateGenerateObjectToolCalls = (
  calls: GenerateObjectToolCall[] | undefined,
  tools: GenerateObjectOfferedTool[] | undefined,
): GenerateObjectToolCall[] | undefined => {
  if (!tools?.length) return calls;
  if (!calls?.length) return undefined;

  const byName = new Map<string, GenerateObjectOfferedTool['function']>();
  for (const tool of tools) {
    const name = tool.function?.name;
    if (typeof name === 'string') byName.set(name, tool.function);
  }

  for (const call of calls) {
    const offered = byName.get(call.name);
    if (!offered) return undefined;
    if (!argumentsMatchSchema(call.arguments, offered.parameters)) return undefined;
  }
  return calls;
};
