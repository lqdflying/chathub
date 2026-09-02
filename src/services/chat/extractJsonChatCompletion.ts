const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const joinTextParts = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      const record = asRecord(part);
      if (!record) return '';
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      return '';
    })
    .join('');
};

const extractMessageText = (message: Record<string, unknown> | undefined) =>
  joinTextParts(message?.content);

const extractMessageReasoning = (message: Record<string, unknown> | undefined) => {
  if (!message) return '';
  if (typeof message.reasoning_content === 'string') return message.reasoning_content;
  const reasoning = message.reasoning;
  if (typeof reasoning === 'string') return reasoning;
  return joinTextParts(asRecord(reasoning)?.content);
};

const extractResponsesOutput = (data: Record<string, unknown>) => {
  let text = typeof data.output_text === 'string' ? data.output_text : '';
  let reasoning = '';
  const output = Array.isArray(data.output) ? data.output : [];

  for (const item of output) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.type === 'message') {
      text += joinTextParts(record.content);
    }
    if (record.type === 'reasoning') {
      reasoning += joinTextParts(record.summary ?? record.content ?? record.text);
    }
  }

  return { reasoning, text };
};

/**
 * Pull assistant text (and optional reasoning) from a non-stream Chat Completions
 * or Responses JSON body. Used by Connectivity Check so Safari can `response.json()`
 * instead of parsing a short synthetic SSE.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
 */
export const extractJsonChatCompletionResult = (
  data: unknown,
): { reasoning: string; text: string } => {
  const record = asRecord(data);
  if (!record) return { reasoning: '', text: '' };

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message) ?? asRecord(firstChoice?.delta);
  const text = extractMessageText(message);
  const reasoning = extractMessageReasoning(message);
  if (text.trim() || reasoning.trim()) return { reasoning, text };

  return extractResponsesOutput(record);
};
