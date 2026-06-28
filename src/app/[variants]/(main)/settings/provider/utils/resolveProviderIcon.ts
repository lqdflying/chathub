const PROVIDER_ICON_MAP: Record<string, string> = {
  anthropiccompatible: 'anthropic',
  openaicompatible: 'openai',
};

export const resolveProviderIcon = (id: string): string => PROVIDER_ICON_MAP[id] || id;
