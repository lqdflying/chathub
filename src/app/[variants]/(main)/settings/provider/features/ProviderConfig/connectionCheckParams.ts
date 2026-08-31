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
    case 'zhipu':
      // GLM-5.2/4.x reasoning models enable Deep Thinking by default; with the
      // 256-token probe budget the thinking phase exhausts tokens and surfaces
      // no final content → ConnectionCheckFailed. Disable thinking for the
      // connectivity probe (mirrors moonshot). buildZhipuPayload drops the
      // field for non-thinking ids, so this is safe for all Zhipu models.
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    case 'minimax':
      return {
        ...cappedBase,
        reasoning_split: false,
      };
    case 'mimo':
      // MiMo Chat Completions defaults thinking to enabled; the 256-token
      // probe would be consumed by thinking and surface no final content.
      return {
        ...cappedBase,
        thinking: { type: 'disabled' as const },
      };
    default:
      return cappedBase;
  }
};
