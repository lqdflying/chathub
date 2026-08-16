'use client';

import { useRouter } from 'next/navigation';
import { memo, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import { enableNextAuth } from '@/const/auth';
import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { useIsMobile } from '@/hooks/useIsMobile';
import { subscribeAccountScopeInvalidation } from '@/store/accountScopeInvalidation';
import { resetAccountScopedStores } from '@/store/accountScopeReset';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const StoreInitialization = memo(() => {
  // prefetch error ns to avoid don't show error content correctly
  useTranslation('error');

  const router = useRouter();
  const [currentUserScope, isLogin, isSignedIn, ownershipInvalidationGeneration, useInitUserState] =
    useUserStore((s) => [
      authSelectors.currentUserScope(s),
      authSelectors.isLogin(s),
      s.isSignedIn,
      s.ownershipInvalidationGeneration,
      s.useInitUserState,
    ]);
  const previousAccountBoundaryRef = useRef({
    ownershipInvalidationGeneration,
    scope: currentUserScope,
  });

  const { serverConfig } = useServerConfigStore();

  const useInitSystemStatus = useGlobalStore((s) => s.useInitSystemStatus);

  const useInitAgentStore = useAgentStore((s) => s.useInitInboxAgentStore);
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);

  // init the system preference
  useInitSystemStatus();

  // fetch server config
  const useFetchServerConfig = useServerConfigStore((s) => s.useInitServerConfig);
  useFetchServerConfig();

  // Update NextAuth status
  const useUserStoreUpdater = createStoreUpdater(useUserStore);
  const oAuthSSOProviders = useServerConfigStore(serverConfigSelectors.oAuthSSOProviders);
  useUserStoreUpdater('oAuthSSOProviders', oAuthSSOProviders);

  /**
   * The store function of `isLogin` will both consider the values of `enableAuth` and `isSignedIn`.
   * But during initialization, the value of `enableAuth` might be incorrect cause of the async fetch.
   * So we need to use `isSignedIn` only to determine whether request for the default agent config and user state.
   *
   * IMPORTANT: Explicitly convert to boolean to avoid passing null/undefined downstream,
   * which would cause unnecessary API requests with invalid login state.
   */
  const isLoginOnInit = Boolean(enableNextAuth ? isSignedIn : isLogin);
  const userStateScope = isLoginOnInit ? currentUserScope : undefined;

  useLayoutEffect(() => {
    return subscribeAccountScopeInvalidation((invalidation) => {
      previousAccountBoundaryRef.current = {
        ownershipInvalidationGeneration: invalidation.generation,
        scope: invalidation.scope,
      };
      resetAccountScopedStores('User state owner mismatch');
    });
  }, []);

  useLayoutEffect(() => {
    const previousAccountBoundary = previousAccountBoundaryRef.current;
    const didAccountBoundaryChange =
      previousAccountBoundary.scope !== currentUserScope ||
      previousAccountBoundary.ownershipInvalidationGeneration !== ownershipInvalidationGeneration;
    if (!didAccountBoundaryChange) return;

    previousAccountBoundaryRef.current = {
      ownershipInvalidationGeneration,
      scope: currentUserScope,
    };
    resetAccountScopedStores(
      authSelectors.hasActiveUserStateOwnerMismatch(useUserStore.getState())
        ? 'User state owner mismatch'
        : 'User account scope changed',
    );
  }, [currentUserScope, ownershipInvalidationGeneration]);

  // init inbox agent and default agent config
  useInitAgentStore(isLoginOnInit, userStateScope, serverConfig.defaultAgent?.config);

  // init user provider key vaults
  useInitAiProviderKeyVaults(isLoginOnInit, userStateScope);

  // hydrate the owner-aware image generation config globally (not only on the
  // /image page) so the built-in chat Image tool uses the user's saved model
  useFetchAiImageConfig();

  // init user state
  useInitUserState(isLoginOnInit, userStateScope, serverConfig, {
    onSuccess: (state) => {
      if (state.isOnboard === false) {
        router.push('/onboard');
      }
    },
  });

  const useStoreUpdater = createStoreUpdater(useGlobalStore);

  const mobile = useIsMobile();

  useStoreUpdater('isMobile', mobile);
  useStoreUpdater('router', router);

  return null;
});

export default StoreInitialization;
