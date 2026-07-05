export const CONNECTION_CHECK_MAX_TOKENS = 256;

export const hasConnectionCheckOutput = (value: unknown) =>
  typeof value === 'string' ? value.trim().length > 0 : !!value;

export const hasConnectionCheckResult = (
  text: unknown,
  reasoning?: { content?: string },
) => hasConnectionCheckOutput(text) || hasConnectionCheckOutput(reasoning?.content);

export const buildConnectionCheckParams = (provider: string, model: string) => {
  const base = {
    messages: [{ content: 'hello', role: 'user' as const }],
    max_tokens: CONNECTION_CHECK_MAX_TOKENS,
    model,
    provider,
  };

  switch (provider) {
    case 'moonshot':
      return {
        ...base,
        thinking: { type: 'disabled' as const },
      };
    case 'minimax':
      return {
        ...base,
        reasoning_split: false,
      };
    default:
      return base;
  }
};
