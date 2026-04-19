/** Sentinel for agent `reasoningBudgetToken`: maps to Anthropic `thinking.type: "adaptive"`. */
export const REASONING_BUDGET_TOKEN_ADAPTIVE = -1;

/** API rejects `thinking.type: "enabled"` for these; UI should offer Adaptive only. */
export const anthropicAdaptiveOnlyThinkingModels = new Set(['claude-opus-4-7']);

/** Models that accept `thinking.type: "adaptive"` (Anthropic adaptive thinking). */
export const anthropicAdaptiveCapableModels = new Set([
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
]);

export const supportsAnthropicAdaptiveThinking = (model: string): boolean =>
  anthropicAdaptiveCapableModels.has(model);

export const isAnthropicAdaptiveThinkingOnlyModel = (model: string): boolean =>
  anthropicAdaptiveOnlyThinkingModels.has(model);
