export interface InputBudgetInput {
  /** Model card context window. */
  contextWindowTokens?: number;
  /** Model card maximum completion. Ignored when it is not lower than the window. */
  maxOutput?: number;
  /** Completion cap the next request will send (`params.max_tokens`). */
  maxTokens?: number;
}

/**
 * Tokens reserved for the completion, so the compaction ratio is against the
 * input that can still be sent. An equal context and max-output card (the
 * window is shared, not pre-reserved) reserves nothing.
 */
/**
 * Completion cap the next request will actually send. A saved `max_tokens`
 * value is ignored while the max-tokens switch is off; the settings form keeps
 * that number hidden rather than clearing it.
 */
export const requestedCompletionCap = (
  enableMaxTokens: boolean | undefined,
  maxTokens: unknown,
): number | undefined => {
  if (!enableMaxTokens) return undefined;
  return typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
    ? maxTokens
    : undefined;
};

export const resolveReservedOutputTokens = ({
  contextWindowTokens,
  maxOutput,
  maxTokens,
}: InputBudgetInput): number => {
  if (!contextWindowTokens || contextWindowTokens <= 1) return 0;

  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    return Math.min(Math.floor(maxTokens), contextWindowTokens - 1);
  }

  if (
    typeof maxOutput === 'number' &&
    Number.isFinite(maxOutput) &&
    maxOutput > 0 &&
    maxOutput < contextWindowTokens
  ) {
    return Math.floor(maxOutput);
  }

  return 0;
};

export const resolveInputBudgetTokens = (input: InputBudgetInput): number => {
  const context = input.contextWindowTokens ?? 0;
  if (!Number.isFinite(context) || context <= 0) return 0;
  return Math.max(1, Math.floor(context) - resolveReservedOutputTokens(input));
};
