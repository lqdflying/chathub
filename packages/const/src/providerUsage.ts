/**
 * Native providers whose credit balance, plan quota, or spend can be read
 * server-side. OpenAI-compatible, Anthropic-compatible, and custom providers
 * are intentionally excluded.
 */
export const PROVIDER_USAGE_API_KEY_PROVIDERS = ['deepseek', 'moonshot'] as const;

/**
 * Providers whose inference API key cannot read billing data. They need a
 * separate admin / management key that is stored server-side only.
 */
export const PROVIDER_USAGE_ADMIN_PROVIDERS = [] as const;

export type ProviderUsageApiKeyProvider = (typeof PROVIDER_USAGE_API_KEY_PROVIDERS)[number];
export type ProviderUsageAdminProvider = (typeof PROVIDER_USAGE_ADMIN_PROVIDERS)[number];
export type ProviderUsageProvider = ProviderUsageAdminProvider | ProviderUsageApiKeyProvider;

export const isProviderUsageAdminProvider = (
  provider?: string | null,
): provider is ProviderUsageAdminProvider =>
  !!provider && (PROVIDER_USAGE_ADMIN_PROVIDERS as readonly string[]).includes(provider);

export const isProviderUsageProvider = (
  provider?: string | null,
): provider is ProviderUsageProvider =>
  !!provider &&
  ((PROVIDER_USAGE_API_KEY_PROVIDERS as readonly string[]).includes(provider) ||
    isProviderUsageAdminProvider(provider));
