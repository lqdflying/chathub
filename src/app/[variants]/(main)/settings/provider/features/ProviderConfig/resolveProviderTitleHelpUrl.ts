import { ModelProvider } from 'model-bank';

const COMPATIBILITY_PROVIDER_IDS = new Set<string>([
  ModelProvider.AnthropicCompatible,
  ModelProvider.OpenAICompatible,
]);

export const resolveProviderTitleHelpUrl = (
  id: string,
  officialUrl?: string,
): string | undefined => {
  if (COMPATIBILITY_PROVIDER_IDS.has(id)) return undefined;

  const trimmed = officialUrl?.trim();
  return trimmed ? trimmed : undefined;
};
