import { useEffect } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useFetchAiImageConfig = () => {
  const isStatusInit = useGlobalStore(systemStatusSelectors.isStatusInit);
  const isInitAiProviderRuntimeState = useAiInfraStore(
    aiProviderSelectors.isInitAiProviderRuntimeState,
  );
  const enabledImageModelSignature = useAiInfraStore((state) =>
    aiProviderSelectors
      .enabledImageModelList(state)
      .flatMap((provider) =>
        provider.children.map(
          (model) => `${provider.id}/${model.id}/${JSON.stringify(model.parameters)}`,
        ),
      )
      .join('|'),
  );

  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isActualLogout = isAuthLoaded && isLogin === false;

  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isUserStateReady = isUserStateInit || isActualLogout;

  const isReadyForInit = isStatusInit && isInitAiProviderRuntimeState && isUserStateReady;

  const {
    lastSelectedImageModel,
    lastSelectedImageNum,
    lastSelectedImageProvider,
    lastSelectedImageSize,
  } = useGlobalStore((s) => ({
    lastSelectedImageModel: s.status.lastSelectedImageModel,
    lastSelectedImageNum: s.status.lastSelectedImageNum,
    lastSelectedImageProvider: s.status.lastSelectedImageProvider,
    lastSelectedImageSize: s.status.lastSelectedImageSize,
  }));
  const isInitializedImageConfig = useImageStore((s) => s.isInit);
  const initializeImageConfig = useImageStore((s) => s.initializeImageConfig);
  const revalidateImageConfig = useImageStore((s) => s.revalidateImageConfig);

  useEffect(() => {
    if (!isReadyForInit) return;

    if (!isInitializedImageConfig) {
      initializeImageConfig(
        isLogin,
        lastSelectedImageModel,
        lastSelectedImageProvider,
        lastSelectedImageNum,
        lastSelectedImageSize,
      );
      return;
    }

    revalidateImageConfig();
  }, [
    enabledImageModelSignature,
    isReadyForInit,
    isInitializedImageConfig,
    isLogin,
    lastSelectedImageModel,
    lastSelectedImageNum,
    lastSelectedImageProvider,
    lastSelectedImageSize,
    initializeImageConfig,
    revalidateImageConfig,
  ]);
};
