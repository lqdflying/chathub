const MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS = new Set([
  'moonshot',
]);

export const isModelNativeSearchDisabledProvider = (provider?: string) =>
  !!provider && MODEL_NATIVE_SEARCH_DISABLED_PROVIDERS.has(provider);
