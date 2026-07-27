import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { userService } from '@/services/user';
import { resetAccountScopedStores } from '@/store/accountScopeReset';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));
vi.mock('@/services/user', () => ({
  userService: {
    migrateImageConfig: vi.fn(),
    resetUserSettings: vi.fn(),
    updateAvatar: vi.fn(),
    updateImageConfig: vi.fn(),
    updatePreference: vi.fn(),
    updateUserSettings: vi.fn(),
  },
}));

const setActiveAccount = (): void => {
  useUserStore.setState({
    ...initialState,
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    preference: DEFAULT_PREFERENCE,
    user: { id: 'account-a' },
    userStateInitializationFailure: undefined,
  });
};

const setOwnerMismatch = (): void => {
  useUserStore.setState({
    userStateInitializationFailure: {
      reason: 'owner-mismatch',
      scope: 'user:account-a',
    },
  });
};

describe('user mutation ownership boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveAccount();
  });

  it.each([
    ['settings', () => useUserStore.getState().setSettings({ general: { fontSize: 16 } })],
    ['settings reset', () => useUserStore.getState().resetSettings()],
    ['avatar', () => useUserStore.getState().updateAvatar('avatar-data')],
    ['preference', () => useUserStore.getState().updatePreference({ hideSyncAlert: true })],
    [
      'image configuration',
      () => useUserStore.getState().updateImageConfigState({ imageNum: 4 }),
    ],
    [
      'image configuration migration',
      () =>
        useUserStore.getState().migrateImageConfigState({
          model: 'image-model',
          provider: 'image-provider',
        }),
    ],
  ])('blocks %s persistence before local mutation during an owner mismatch', async (_, mutate) => {
    const settingsBefore = useUserStore.getState().settings;
    const preferenceBefore = useUserStore.getState().preference;
    setOwnerMismatch();

    await expect(mutate()).rejects.toThrow('User state ownership is not active');

    expect(useUserStore.getState().settings).toEqual(settingsBefore);
    expect(useUserStore.getState().preference).toEqual(preferenceBefore);
    expect(userService.updateUserSettings).not.toHaveBeenCalled();
    expect(userService.resetUserSettings).not.toHaveBeenCalled();
    expect(userService.updateAvatar).not.toHaveBeenCalled();
    expect(userService.updatePreference).not.toHaveBeenCalled();
    expect(userService.updateImageConfig).not.toHaveBeenCalled();
    expect(userService.migrateImageConfig).not.toHaveBeenCalled();
  });

  it('aborts and clears a pending settings mutation during account invalidation', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(userService.updateUserSettings).mockImplementation(
      async (_settings, signal) =>
        new Promise((resolve) => {
          requestSignal = signal;
          signal?.addEventListener('abort', () => resolve(undefined), {
            once: true,
          });
        }),
    );

    const mutationPromise = useUserStore
      .getState()
      .setSettings({ general: { fontSize: 16 } });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    resetAccountScopedStores('User state owner mismatch');
    await expect(mutationPromise).resolves.toBeUndefined();

    expect(requestSignal?.aborted).toBe(true);
    expect(useUserStore.getState().updateSettingsSignal).toBeUndefined();
    expect(useUserStore.getState().userMutationAbortControllers).toEqual([]);
  });
});
