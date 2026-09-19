const GPT_MODEL_VERSION_PATTERN = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/i;

export const supportsTrustedPromptCacheKey = (model: string): boolean => {
  const versionMatch = GPT_MODEL_VERSION_PATTERN.exec(model.trim());
  if (!versionMatch) return false;

  const majorVersion = Number(versionMatch[1]);
  const minorVersion = Number(versionMatch[2] ?? 0);

  return majorVersion > 5 || (majorVersion === 5 && minorVersion >= 6);
};

/** Native OpenAI GPT-5.6+ and every xAI Grok chat id accept a trusted conversation cache key. */
export const usesTrustedNativePromptCache = (providerId: string, model: string): boolean =>
  (providerId === 'openai' && supportsTrustedPromptCacheKey(model)) || providerId === 'xai';
