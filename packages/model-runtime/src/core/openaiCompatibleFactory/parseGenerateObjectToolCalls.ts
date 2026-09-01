type GenerateObjectToolCall = { arguments: Record<string, unknown>; name: string };

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

const mapNamedToolCalls = (items: unknown[]): GenerateObjectToolCall[] =>
  items.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const fn = asRecord(record.function);
    const name =
      typeof record.name === 'string'
        ? record.name
        : typeof record.tool_name === 'string'
          ? record.tool_name
          : typeof fn?.name === 'string'
            ? fn.name
            : undefined;
    if (!name) return [];
    return [
      {
        arguments: parseToolCallArguments(record.arguments ?? record.parameter ?? fn?.arguments),
        name,
      },
    ];
  });

/**
 * Parse OpenAI-style `tool_calls` or JSON-mode content that encodes the same
 * selection (`{ tool_calls: [...] }`, an array of `{ name, arguments }`, or a
 * single named object). Used when a provider cannot force `tool_choice`.
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
