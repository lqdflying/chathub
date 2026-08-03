import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';

import { createHeaderWithAuth, createPayloadWithKeyVaults } from '../_auth';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));
describe('account ownership validation', () => {
  beforeEach(() => {
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'account-a' },
      userStateInitializationFailure: undefined,
    });
    useAiInfraStore.setState({
      aiProviderRuntimeConfig: {
        openai: {
          keyVaults: { apiKey: 'stale-account-secret' },
          settings: {},
        },
      } as any,
      runtimeStateRequestScope: 'user:account-a',
      runtimeStateScope: 'user:account-a',
    });
  });

  it('blocks provider payloads and auth headers after an active owner mismatch', async () => {
    useUserStore.setState({
      userStateInitializationFailure: {
        reason: 'owner-mismatch',
        scope: 'user:account-a',
      },
    });

    expect(() => createPayloadWithKeyVaults(ModelProvider.OpenAI)).toThrow(
      'user state ownership is not initialized',
    );
    await expect(createHeaderWithAuth()).rejects.toThrow(
      'user state ownership is not initialized',
    );
  });
});
