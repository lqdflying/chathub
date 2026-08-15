import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useApiKey } from './useApiKey';

// providerConfigById reads aiProviderRuntimeConfig[id]; the crash case is a
// provider entry whose runtime config exists WITHOUT keyVaults (not hydrated)
const mockState = {
  aiProviderRuntimeConfig: {
    'no-vaults': { settings: {} },
    'with-vaults': { keyVaults: { apiKey: 'k', baseURL: 'https://x' }, settings: {} },
  },
};

vi.mock('@/store/aiInfra', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/aiInfra')>()),
  useAiInfraStore: (selector: (s: any) => unknown) => selector(mockState),
}));

describe('useApiKey', () => {
  it('does not throw when the provider config has no keyVaults (render-crash regression)', () => {
    const { result } = renderHook(() => useApiKey('no-vaults'));
    expect(result.current.apiKey).toBeUndefined();
    expect(result.current.baseURL).toBeUndefined();
  });

  it('does not throw for a completely unknown provider', () => {
    const { result } = renderHook(() => useApiKey('missing-provider'));
    expect(result.current.apiKey).toBeUndefined();
  });

  it('returns the vault values when hydrated', () => {
    const { result } = renderHook(() => useApiKey('with-vaults'));
    expect(result.current.apiKey).toBe('k');
    expect(result.current.baseURL).toBe('https://x');
  });
});
