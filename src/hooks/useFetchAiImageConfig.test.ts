import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFetchAiImageConfig } from './useFetchAiImageConfig';

const {
  aiInfraState,
  globalState,
  imageState,
  initializeImageConfig,
  migrateImageConfigState,
  revalidateImageConfig,
  resetImageConfigAvailability,
  serverConfigState,
  updateImageConfig,
  userState,
} = vi.hoisted(() => {
  const updateImageConfig = vi.fn(() => Promise.resolve());
  const userState = {
    authUserId: 'user-id',
    currentUserScope: 'user:user-id',
    isLoaded: false,
    isLogin: true,
    isUserStateInit: false,
    preference: {
      imageConfig: {
        imageNum: 8,
        model: 'size-model',
        provider: 'custom-provider',
        size: '1536x1024',
      },
    },
    user: { id: 'user-id' },
    userStateOwnerId: 'user-id',
    userStateScope: 'user:user-id',
  };

  return {
    aiInfraState: {
      enabledImageModelList: [
        {
          children: [{ id: 'size-model', parameters: { size: { enum: ['1536x1024'] } } }],
          id: 'custom-provider',
        },
      ],
      isInitialized: false,
      requestScope: 'user:user-id',
      scope: 'user:user-id',
    },
    globalState: {
      isStatusInit: false,
      status: {
        lastSelectedImageModel: 'size-model',
        lastSelectedImageNum: 8,
        lastSelectedImageProvider: 'custom-provider',
        lastSelectedImageSize: '1536x1024',
      },
    },
    imageState: { isInit: false },
    serverConfigState: {
      serverConfig: { image: { defaultImageNum: 6 } },
    },
    initializeImageConfig: vi.fn(),
    migrateImageConfigState: vi.fn(async (imageConfig) => {
      await updateImageConfig(imageConfig);
    }),
    revalidateImageConfig: vi.fn(),
    resetImageConfigAvailability: vi.fn(() => {
      imageState.isInit = false;
    }),
    updateImageConfig,
    userState,
  };
});

vi.mock('@/services/user', () => ({
  userService: {
    updateImageConfig,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: (state: typeof aiInfraState) => state.enabledImageModelList,
    isInitAiProviderRuntimeState: (state: typeof aiInfraState) => state.isInitialized,
  },
  useAiInfraStore: <T>(
    selector: (
      state: typeof aiInfraState & {
        runtimeStateRequestScope: string;
        runtimeStateScope: string;
      },
    ) => T,
  ) =>
    selector({
      ...aiInfraState,
      runtimeStateRequestScope: aiInfraState.requestScope,
      runtimeStateScope: aiInfraState.scope,
    }),
}));

vi.mock('@/store/global', () => {
  const updateSystemStatus = vi.fn((patch: Record<string, unknown>) => {
    Object.assign(globalState.status, patch);
  });
  const useGlobalStore = (<T>(selector: (state: typeof globalState) => T) =>
    selector(globalState)) as {
    <T>(selector: (state: typeof globalState) => T): T;
    getState: () => typeof globalState & {
      updateSystemStatus: typeof updateSystemStatus;
    };
  };
  useGlobalStore.getState = () => ({ ...globalState, updateSystemStatus });
  return { useGlobalStore };
});

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    isStatusInit: (state: typeof globalState) => state.isStatusInit,
  },
}));

vi.mock('@/store/image', () => ({
  useImageStore: Object.assign(
    <T>(
      selector: (
        state: typeof imageState & {
          initializeImageConfig: typeof initializeImageConfig;
          resetImageConfigAvailability: typeof resetImageConfigAvailability;
        },
      ) => T,
    ) =>
      selector({
        ...imageState,
        initializeImageConfig,
        resetImageConfigAvailability,
        revalidateImageConfig,
      }),
    {
      getState: () => ({
        ...imageState,
        initializeImageConfig,
        resetImageConfigAvailability,
        revalidateImageConfig,
      }),
    },
  ),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: <T>(selector: (state: typeof serverConfigState) => T) =>
    selector(serverConfigState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: Object.assign(
    <T>(selector: (state: typeof userState) => T) => selector(userState),
    {
      getState: () => ({ ...userState, migrateImageConfigState }),
    },
  ),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    currentUserScope: (state: typeof userState) => state.currentUserScope,
    isLoaded: (state: typeof userState) => state.isLoaded,
    isLogin: (state: typeof userState) => state.isLogin,
  },
  userProfileSelectors: {
    userId: (state: typeof userState) => state.user.id,
  },
}));

describe('useFetchAiImageConfig', () => {
  beforeEach(() => {
    aiInfraState.isInitialized = false;
    aiInfraState.requestScope = 'user:user-id';
    aiInfraState.scope = 'user:user-id';
    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'size-model', parameters: { size: { enum: ['1536x1024'] } } }],
        id: 'custom-provider',
      },
    ];
    globalState.isStatusInit = false;
    globalState.status = {
      lastSelectedImageModel: 'size-model',
      lastSelectedImageNum: 8,
      lastSelectedImageProvider: 'custom-provider',
      lastSelectedImageSize: '1536x1024',
    };
    imageState.isInit = false;
    serverConfigState.serverConfig.image = { defaultImageNum: 6 };
    initializeImageConfig.mockReset();
    revalidateImageConfig.mockReset();
    resetImageConfigAvailability.mockClear();
    updateImageConfig.mockReset();
    updateImageConfig.mockResolvedValue(undefined);
    migrateImageConfigState.mockClear();
    userState.authUserId = 'user-id';
    userState.currentUserScope = 'user:user-id';
    userState.isLoaded = false;
    userState.isLogin = true;
    userState.isUserStateInit = false;
    userState.user = { id: 'user-id' };
    userState.userStateOwnerId = 'user-id';
    userState.userStateScope = 'user:user-id';
    userState.preference = {
      imageConfig: {
        imageNum: 8,
        model: 'size-model',
        provider: 'custom-provider',
        size: '1536x1024',
      },
    };
  });

  it('initializes once after all preference dependencies are ready', async () => {
    const { rerender } = renderHook(() => useFetchAiImageConfig());

    expect(initializeImageConfig).not.toHaveBeenCalled();

    aiInfraState.isInitialized = true;
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isUserStateInit = true;
    rerender();

    await vi.waitFor(() =>
      expect(initializeImageConfig).toHaveBeenCalledWith(
        'size-model',
        'custom-provider',
        8,
        '1536x1024',
        'user:user-id',
        6,
      ),
    );

    imageState.isInit = true;
    rerender();

    expect(initializeImageConfig).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(revalidateImageConfig).toHaveBeenCalledTimes(1));
    expect(revalidateImageConfig).toHaveBeenLastCalledWith(
      'size-model',
      'custom-provider',
      8,
      '1536x1024',
      'user:user-id',
      6,
    );

    aiInfraState.enabledImageModelList = [
      { children: [{ id: 'gemini-image', parameters: { size: { enum: [] } } }], id: 'google' },
    ];
    rerender();

    expect(initializeImageConfig).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(revalidateImageConfig).toHaveBeenCalledTimes(2));

    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'gemini-image', parameters: { size: { enum: ['1024x1024'] } } }],
        id: 'google',
      },
    ];
    rerender();

    await vi.waitFor(() => expect(revalidateImageConfig).toHaveBeenCalledTimes(3));
  });

  it('does not migrate unowned guest config into an authenticated preference', async () => {
    userState.preference = { imageConfig: {} };
    userState.authUserId = 'account-b';
    userState.currentUserScope = 'user:account-b';
    userState.user = { id: 'account-b' };
    userState.userStateOwnerId = 'account-b';
    userState.userStateScope = 'user:account-b';
    aiInfraState.isInitialized = true;
    aiInfraState.requestScope = 'user:account-b';
    aiInfraState.scope = 'user:account-b';
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isUserStateInit = true;

    renderHook(() => useFetchAiImageConfig());

    await vi.waitFor(() =>
      expect(initializeImageConfig).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        'user:account-b',
        6,
      ),
    );
    expect(migrateImageConfigState).not.toHaveBeenCalled();
    expect(updateImageConfig).not.toHaveBeenCalled();
  });

  it('keeps an existing DB preference without deleting guest settings', async () => {
    vi.resetModules();
    const { useFetchAiImageConfig: freshHook } = await import('./useFetchAiImageConfig');

    userState.authUserId = 'db-preference-user';
    userState.currentUserScope = 'user:db-preference-user';
    userState.user = { id: 'db-preference-user' };
    userState.userStateOwnerId = 'db-preference-user';
    userState.userStateScope = 'user:db-preference-user';
    aiInfraState.isInitialized = true;
    aiInfraState.requestScope = 'user:db-preference-user';
    aiInfraState.scope = 'user:db-preference-user';
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isUserStateInit = true;

    renderHook(() => freshHook());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateImageConfig).not.toHaveBeenCalled();
    expect(globalState.status.lastSelectedImageModel).toBe('size-model');
    expect(initializeImageConfig).toHaveBeenCalledWith(
      'size-model',
      'custom-provider',
      8,
      '1536x1024',
      'user:db-preference-user',
      6,
    );
  });

  it('initializes no-auth mode against the canonical local scope', async () => {
    userState.currentUserScope = 'local';
    userState.userStateScope = 'local';
    aiInfraState.isInitialized = true;
    aiInfraState.requestScope = 'local';
    aiInfraState.scope = 'local';
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isUserStateInit = true;

    renderHook(() => useFetchAiImageConfig());

    await vi.waitFor(() =>
      expect(initializeImageConfig).toHaveBeenCalledWith(
        'size-model',
        'custom-provider',
        8,
        '1536x1024',
        'local',
        6,
      ),
    );
  });

  it('restores guest preferences for a signed-out user', async () => {
    aiInfraState.isInitialized = true;
    aiInfraState.requestScope = 'guest';
    aiInfraState.scope = 'guest';
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isLogin = false;
    userState.currentUserScope = 'guest';
    userState.userStateScope = undefined;

    renderHook(() => useFetchAiImageConfig());

    await vi.waitFor(() =>
      expect(initializeImageConfig).toHaveBeenCalledWith(
        'size-model',
        'custom-provider',
        8,
        '1536x1024',
        'guest',
        6,
      ),
    );
    expect(updateImageConfig).not.toHaveBeenCalled();
  });

  it('revalidates against an empty guest scope after an in-place logout', async () => {
    aiInfraState.isInitialized = true;
    globalState.isStatusInit = true;
    globalState.status = {};
    imageState.isInit = true;
    userState.isLoaded = true;
    userState.isLogin = true;
    userState.isUserStateInit = true;

    const { rerender } = renderHook(() => useFetchAiImageConfig());

    await vi.waitFor(() =>
      expect(revalidateImageConfig).toHaveBeenLastCalledWith(
        'size-model',
        'custom-provider',
        8,
        '1536x1024',
        'user:user-id',
        6,
      ),
    );

    userState.isLogin = false;
    userState.currentUserScope = 'guest';
    userState.userStateScope = undefined;
    aiInfraState.requestScope = 'guest';
    aiInfraState.scope = 'guest';
    rerender();

    await vi.waitFor(() =>
      expect(revalidateImageConfig).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        'guest',
        6,
      ),
    );
  });

  it('keeps image state unavailable while a different account is hydrating', () => {
    aiInfraState.isInitialized = true;
    globalState.isStatusInit = true;
    imageState.isInit = true;
    userState.isLoaded = true;
    userState.isLogin = true;
    userState.isUserStateInit = true;
    userState.user = { id: 'account-b' };
    userState.userStateOwnerId = 'account-a';
    userState.currentUserScope = 'user:account-b';
    userState.userStateScope = 'user:account-a';
    aiInfraState.requestScope = 'user:account-b';
    aiInfraState.scope = 'user:account-a';

    renderHook(() => useFetchAiImageConfig());

    expect(resetImageConfigAvailability).toHaveBeenCalledWith('user:account-b');
    expect(revalidateImageConfig).not.toHaveBeenCalled();
    expect(migrateImageConfigState).not.toHaveBeenCalled();
  });

  it('does not copy guest preferences into an account after an in-place login', async () => {
    userState.preference = { imageConfig: {} };
    userState.currentUserScope = 'guest';
    userState.isLogin = false;
    userState.isLoaded = true;
    userState.userStateScope = undefined;
    aiInfraState.isInitialized = true;
    aiInfraState.requestScope = 'guest';
    aiInfraState.scope = 'guest';
    globalState.isStatusInit = true;
    imageState.isInit = true;

    const { rerender } = renderHook(() => useFetchAiImageConfig());
    expect(updateImageConfig).not.toHaveBeenCalled();

    userState.authUserId = 'in-place-login-user';
    userState.currentUserScope = 'user:in-place-login-user';
    userState.isLogin = true;
    userState.isUserStateInit = true;
    userState.user = { id: 'in-place-login-user' };
    userState.userStateOwnerId = 'in-place-login-user';
    userState.userStateScope = 'user:in-place-login-user';
    aiInfraState.requestScope = 'user:in-place-login-user';
    aiInfraState.scope = 'user:in-place-login-user';
    rerender();

    await vi.waitFor(() =>
      expect(revalidateImageConfig).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        'user:in-place-login-user',
        6,
      ),
    );
    expect(migrateImageConfigState).not.toHaveBeenCalled();
    expect(updateImageConfig).not.toHaveBeenCalled();
  });

  it('initializes an empty authenticated preference without a guest fallback', async () => {
    globalState.status = {};
    userState.preference = { imageConfig: {} };
    aiInfraState.isInitialized = true;
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isUserStateInit = true;

    renderHook(() => useFetchAiImageConfig());

    await vi.waitFor(() =>
      expect(initializeImageConfig).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        'user:user-id',
        6,
      ),
    );
    expect(migrateImageConfigState).not.toHaveBeenCalled();
    expect(updateImageConfig).not.toHaveBeenCalled();
  });
});
