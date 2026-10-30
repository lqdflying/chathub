/** Sentinel for agent `reasoningBudgetToken`: maps to Anthropic `thinking.type: "adaptive"`. */
export const REASONING_BUDGET_TOKEN_ADAPTIVE = -1;

/** API rejects `thinking.type: "enabled"` for these; UI should offer Adaptive only. */
export const anthropicAdaptiveOnlyThinkingModels = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
]);

/** Adaptive thinking is always on; `{ type: "disabled" }` is invalid. */
export const anthropicAlwaysOnThinkingModels = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
]);

/** Models that accept `thinking.type: "adaptive"` (Anthropic adaptive thinking). */
export const anthropicAdaptiveCapableModels = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
]);

/** API default effort is `medium` on these; every other effort-capable model defaults to `high`. */
const anthropicMediumDefaultEffortModels = new Set(['claude-opus-5-5', 'claude-haiku-5-5']);

/** API rejects `tool_choice` types `any` and `tool` for these; only `auto` / `none` are accepted. */
export const anthropicNoForcedToolChoiceModels = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
]);

/**
 * Hidden runtime max-output for saved/fetched Anthropic ids that are no longer
 * in the visible picker. Do not re-enable these cards in the model bank.
 * Values match the last shipped catalogue card for each id.
 */
export const anthropicSavedModelMaxOutput: Record<string, number> = {
  'claude-opus-5': 128_000,
  'claude-sonnet-5': 128_000,
  'claude-opus-4-8': 128_000,
  'claude-opus-4-7': 128_000,
  'claude-opus-4-6': 128_000,
  'claude-sonnet-4-6': 64_000,
  'claude-3-7-sonnet-20250219': 64_000,
  'claude-3-7-sonnet-latest': 64_000,
  'claude-3-5-sonnet-20241022': 8192,
  'claude-3-5-sonnet-20240620': 8192,
  'claude-3-5-sonnet-latest': 8192,
  'claude-3-5-haiku-20241022': 8192,
  'claude-3-5-haiku-latest': 8192,
  'claude-3-haiku-20240307': 4096,
  'claude-3-opus-20240229': 4096,
  'claude-opus-4-1-20250805': 32_000,
  'claude-opus-4-20250514': 32_000,
  'claude-sonnet-4-20250514': 64_000,
  'claude-sonnet-4-5-20250929': 64_000,
  'claude-haiku-4-5-20251001': 64_000,
  'claude-opus-4-5-20251101': 128_000,
};

export const supportsAnthropicAdaptiveThinking = (model: string): boolean =>
  anthropicAdaptiveCapableModels.has(model);

export const isAnthropicAdaptiveThinkingOnlyModel = (model: string): boolean =>
  anthropicAdaptiveOnlyThinkingModels.has(model);

export const isAnthropicAlwaysOnThinkingModel = (model: string): boolean =>
  anthropicAlwaysOnThinkingModels.has(model);

export const getAnthropicDefaultEffort = (model: string): 'medium' | 'high' =>
  anthropicMediumDefaultEffortModels.has(model) ? 'medium' : 'high';

export const getAnthropicRuntimeMaxOutput = (model: string): number | undefined =>
  anthropicSavedModelMaxOutput[model];
