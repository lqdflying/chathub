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
    model,
    provider,
  };
  const cappedBase = {
    ...base,
    max_tokens: CONNECTION_CHECK_MAX_TOKENS,
  };

  switch (provider) {
    case 'openaicompatible':
      return base;
    case 'moonshot':
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    case 'minimax':
      return {
        ...cappedBase,
        reasoning_split: false,
      };
    default:
      return cappedBase;
  }
};
