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
  const providerRuntimeRequestScope = useAiInfraStore((state) => state.runtimeStateRequestScope);
  const providerRuntimeScope = useAiInfraStore((state) => state.runtimeStateScope);
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
  const preferenceOwner = useUserStore(authSelectors.currentUserScope);

  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const userStateScope = useUserStore((s) => s.userStateScope);
  const isGuestScope = preferenceOwner === 'guest';
  const isCurrentUserStateReady =
    !!isLogin && !!preferenceOwner && isUserStateInit && userStateScope === preferenceOwner;
  const isUserStateReady = isCurrentUserStateReady || (isAuthLoaded && isGuestScope);
  const isCurrentProviderRuntimeReady =
    !!preferenceOwner &&
    isInitAiProviderRuntimeState &&
    providerRuntimeRequestScope === preferenceOwner &&
    providerRuntimeScope === preferenceOwner;

  const isReadyForInit = isStatusInit && isCurrentProviderRuntimeReady && isUserStateReady;
  const shouldResetPendingUserScope =
    isStatusInit &&
    isAuthLoaded &&
    !!isLogin &&
    !!preferenceOwner &&
    (!isCurrentUserStateReady || !isCurrentProviderRuntimeReady);

  // DB-backed, cross-device image config for signed-in users.
  const imageConfig = useUserStore((s) => s.preference.imageConfig);

  const legacyImageConfig = useGlobalStore((s) => ({
    imageNum: s.status.lastSelectedImageNum,
    model: s.status.lastSelectedImageModel,
    provider: s.status.lastSelectedImageProvider,
    size: s.status.lastSelectedImageSize,
  }));

  const resolvedImageConfig = isGuestScope ? legacyImageConfig : imageConfig || {};

  const isInitializedImageConfig = useImageStore((s) => s.isInit);
  const initializeImageConfig = useImageStore((s) => s.initializeImageConfig);
  const resetImageConfigAvailability = useImageStore((s) => s.resetImageConfigAvailability);
  const revalidateImageConfig = useImageStore((s) => s.revalidateImageConfig);

  useEffect(() => {
    if (!isReadyForInit) {
      if (shouldResetPendingUserScope) {
        resetImageConfigAvailability(preferenceOwner);
      }
      return;
    }

    const initializeResolvedImageConfig = () => {
      if (!useImageStore.getState().isInit) {
        initializeImageConfig(
          resolvedImageConfig.model,
          resolvedImageConfig.provider,
          resolvedImageConfig.imageNum,
          resolvedImageConfig.size,
          preferenceOwner,
        );
        return;
      }

      revalidateImageConfig(
        resolvedImageConfig.model,
        resolvedImageConfig.provider,
        resolvedImageConfig.imageNum,
        resolvedImageConfig.size,
        preferenceOwner,
      );
    };

    initializeResolvedImageConfig();
  }, [
    enabledImageModelSignature,
    isReadyForInit,
    isInitializedImageConfig,
    isLogin,
    isCurrentUserStateReady,
    initializeImageConfig,
    preferenceOwner,
    resetImageConfigAvailability,
    revalidateImageConfig,
    resolvedImageConfig.imageNum,
    resolvedImageConfig.model,
    resolvedImageConfig.provider,
    resolvedImageConfig.size,
    shouldResetPendingUserScope,
  ]);
};
