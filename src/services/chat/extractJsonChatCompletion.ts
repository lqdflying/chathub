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
  const outputText =
    typeof data.output_text === 'string' && data.output_text.trim() ? data.output_text : '';
  let messageText = '';
  let reasoning = '';
  const output = Array.isArray(data.output) ? data.output : [];

  for (const item of output) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.type === 'message') {
      messageText += joinTextParts(record.content);
    }
    if (record.type === 'reasoning') {
      reasoning += joinTextParts(record.summary ?? record.content ?? record.text);
    }
  }

  // `output_text` is the SDK's synthesized helper for the same message content.
  // Do not concatenate both representations.
  return { reasoning, text: outputText || messageText };
};

type JsonValueKind = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string' | 'undefined';

const jsonValueKind = (value: unknown): JsonValueKind => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsonValueKind;
};

const diagnosticScalar = (value: unknown): boolean | number | string | undefined =>
  typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined;

export interface JsonChatCompletionInspection {
  completed: boolean;
  summary: {
    baseStatus?: boolean | number | string;
    choiceCount: number;
    contentLength: number;
    contentType: JsonValueKind;
    finishReason?: boolean | number | string;
    kind: 'chat_completions' | 'responses' | 'unknown';
    mediaType?: string;
    messageKeys: string[];
    reasoningLength: number;
    reasoningType: JsonValueKind;
    responseStatus?: boolean | number | string;
    topLevelKeys: string[];
    transport?: 'browser' | 'server';
  };
}

/**
 * Build a content-free diagnostic summary of a JSON completion. Connectivity
 * Check can use the terminal envelope as proof that MiniMax completed even if
 * a mobile browser exposes no assistant text. Never include provider output.
 */
export const inspectJsonChatCompletion = (data: unknown): JsonChatCompletionInspection => {
  const record = asRecord(data);
  if (!record) {
    return {
      completed: false,
      summary: {
        choiceCount: 0,
        contentLength: 0,
        contentType: jsonValueKind(undefined),
        kind: 'unknown',
        messageKeys: [],
        reasoningLength: 0,
        reasoningType: jsonValueKind(undefined),
        topLevelKeys: [],
      },
    };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message) ?? asRecord(firstChoice?.delta);
  const baseStatus = diagnosticScalar(asRecord(record.base_resp)?.status_code);
  const finishReason = diagnosticScalar(firstChoice?.finish_reason);
  const responseStatus = diagnosticScalar(record.status);
  const providerSucceeded = baseStatus === undefined || baseStatus === 0 || baseStatus === '0';
  const chatCompleted =
    choices.length > 0 && typeof finishReason === 'string' && finishReason.trim().length > 0;
  const responsesCompleted = responseStatus === 'completed';
  const kind =
    choices.length > 0
      ? 'chat_completions'
      : record.object === 'response' || Array.isArray(record.output)
        ? 'responses'
        : 'unknown';

  return {
    completed: providerSucceeded && (chatCompleted || responsesCompleted),
    summary: {
      baseStatus,
      choiceCount: choices.length,
      contentLength: extractMessageText(message).length,
      contentType: jsonValueKind(message?.content),
      finishReason,
      kind,
      messageKeys: message ? Object.keys(message).sort().slice(0, 24) : [],
      reasoningLength: extractMessageReasoning(message).length,
      reasoningType: jsonValueKind(message?.reasoning_content ?? message?.reasoning),
      responseStatus,
      topLevelKeys: Object.keys(record).sort().slice(0, 24),
    },
  };
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
