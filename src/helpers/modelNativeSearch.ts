const MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS = new Set([
  'anthropiccompatible',
  'moonshot',
  'openaicompatible',
]);

export const isModelNativeSearchDisabledProvider = (provider?: string) =>
  !!provider && MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS.has(provider);
