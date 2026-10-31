import { describe, expect, it } from 'vitest';

import {
  PROVIDER_USAGE_ADMIN_PROVIDERS,
  PROVIDER_USAGE_API_KEY_PROVIDERS,
  isProviderUsageProvider,
} from '@/const/providerUsage';

import { getProviderUsageAdapter } from './index';

describe('provider usage adapter registry', () => {
  it('has an adapter for every provider the UI offers, with the matching key type', () => {
    for (const provider of PROVIDER_USAGE_API_KEY_PROVIDERS) {
      expect(getProviderUsageAdapter(provider)?.credentialType, provider).toBe('apiKey');
    }
    for (const provider of PROVIDER_USAGE_ADMIN_PROVIDERS as readonly string[]) {
      expect(getProviderUsageAdapter(provider)?.credentialType, provider).toBe('admin');
    }
  });

  it('never offers compatible or custom providers', () => {
    for (const provider of ['openaicompatible', 'anthropiccompatible', 'custom-gateway']) {
      expect(isProviderUsageProvider(provider)).toBe(false);
      expect(getProviderUsageAdapter(provider)).toBeUndefined();
    }
  });
});
