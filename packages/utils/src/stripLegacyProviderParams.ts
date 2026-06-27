const LEGACY_PROVIDER_PARAM_KEYS = [
  'frequency_penalty',
  'presence_penalty',
  'temperature',
  'top_p',
] as const;

export const stripLegacyProviderParams = <T extends Record<string, any>>(payload: T): T => {
  for (const key of LEGACY_PROVIDER_PARAM_KEYS) {
    delete payload[key];
  }

  return payload;
};
