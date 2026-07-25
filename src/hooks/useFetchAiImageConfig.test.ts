import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFetchAiImageConfig } from './useFetchAiImageConfig';

const {
  aiInfraState,
  globalState,
  imageState,
  initializeImageConfig,
  revalidateImageConfig,
  userState,
} = vi.hoisted(() => ({
  aiInfraState: {
    enabledImageModelList: [
      {
        children: [{ id: 'size-model', parameters: { size: { enum: ['1536x1024'] } } }],
        id: 'custom-provider',
      },
    ],
    isInitialized: false,
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
  initializeImageConfig: vi.fn(),
  revalidateImageConfig: vi.fn(),
  userState: {
    isLoaded: false,
    isLogin: true,
    isUserStateInit: false,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: (state: typeof aiInfraState) => state.enabledImageModelList,
    isInitAiProviderRuntimeState: (state: typeof aiInfraState) => state.isInitialized,
  },
  useAiInfraStore: <T>(selector: (state: typeof aiInfraState) => T) => selector(aiInfraState),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: <T>(selector: (state: typeof globalState) => T) => selector(globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    isStatusInit: (state: typeof globalState) => state.isStatusInit,
  },
}));

vi.mock('@/store/image', () => ({
  useImageStore: <T>(
    selector: (
      state: typeof imageState & { initializeImageConfig: typeof initializeImageConfig },
    ) => T,
  ) => selector({ ...imageState, initializeImageConfig, revalidateImageConfig }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T>(selector: (state: typeof userState) => T) => selector(userState),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLoaded: (state: typeof userState) => state.isLoaded,
    isLogin: (state: typeof userState) => state.isLogin,
  },
}));

describe('useFetchAiImageConfig', () => {
  beforeEach(() => {
    aiInfraState.isInitialized = false;
    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'size-model', parameters: { size: { enum: ['1536x1024'] } } }],
        id: 'custom-provider',
      },
    ];
    globalState.isStatusInit = false;
    imageState.isInit = false;
    initializeImageConfig.mockReset();
    revalidateImageConfig.mockReset();
    userState.isLoaded = false;
    userState.isLogin = true;
    userState.isUserStateInit = false;
  });

  it('initializes once after all preference dependencies are ready', () => {
    const { rerender } = renderHook(() => useFetchAiImageConfig());

    expect(initializeImageConfig).not.toHaveBeenCalled();

    aiInfraState.isInitialized = true;
    globalState.isStatusInit = true;
    userState.isLoaded = true;
    userState.isUserStateInit = true;
    rerender();

    expect(initializeImageConfig).toHaveBeenCalledWith(
      true,
      'size-model',
      'custom-provider',
      8,
      '1536x1024',
    );

    imageState.isInit = true;
    rerender();

    expect(initializeImageConfig).toHaveBeenCalledTimes(1);
    expect(revalidateImageConfig).toHaveBeenCalledTimes(1);

    aiInfraState.enabledImageModelList = [
      { children: [{ id: 'gemini-image', parameters: { size: { enum: [] } } }], id: 'google' },
    ];
    rerender();

    expect(initializeImageConfig).toHaveBeenCalledTimes(1);
    expect(revalidateImageConfig).toHaveBeenCalledTimes(2);

    aiInfraState.enabledImageModelList = [
      {
        children: [{ id: 'gemini-image', parameters: { size: { enum: ['1024x1024'] } } }],
        id: 'google',
      },
    ];
    rerender();

    expect(revalidateImageConfig).toHaveBeenCalledTimes(3);
  });
});
