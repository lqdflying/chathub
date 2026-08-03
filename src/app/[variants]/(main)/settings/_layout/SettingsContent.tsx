'use client';

import { Alert, Button } from '@lobehub/ui';
import { LogIn, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import React, { CSSProperties, ReactNode, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import Loading from '@/components/Loading/BrandTextLoading';
import { SettingsTabs } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const componentMap = {
  [SettingsTabs.Common]: dynamic(() => import('../common'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.ChatInstruction]: dynamic(() => import('../chat-instruction'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.Agent]: dynamic(() => import('../agent'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.Provider]: dynamic(() => import('../provider'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.TTS]: dynamic(() => import('../tts'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.About]: dynamic(() => import('../about'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.Hotkey]: dynamic(() => import('../hotkey'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.Storage]: dynamic(() => import('../storage'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.SystemAgent]: dynamic(() => import('../system-agent'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.Mcp]: dynamic(() => import('../mcp'), {
    loading: () => <Loading />,
  }),
  [SettingsTabs.Skills]: dynamic(() => import('../skills'), {
    loading: () => <Loading />,
  }),
};

const userStateDependentTabs = new Set<string>([
  SettingsTabs.Agent,
  SettingsTabs.ChatInstruction,
  SettingsTabs.Common,
  SettingsTabs.Hotkey,
  SettingsTabs.Mcp,
  SettingsTabs.Skills,
  SettingsTabs.Provider,
  SettingsTabs.Storage,
  SettingsTabs.SystemAgent,
  SettingsTabs.TTS,
]);

interface UserStateBootstrapGuardProps {
  children: ReactNode;
  tab: string;
}

const UserStateBootstrapGuard = memo<UserStateBootstrapGuardProps>(({ children, tab }) => {
  const { t } = useTranslation('setting');
  const [retryingScope, setRetryingScope] = useState<string>();
  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserScope = useUserStore(authSelectors.currentUserScope);
  const isUserStateInit = useUserStore((state) => state.isUserStateInit);
  const userStateScope = useUserStore((state) => state.userStateScope);
  const userStateInitializationFailure = useUserStore(
    (state) => state.userStateInitializationFailure,
  );
  const logout = useUserStore((state) => state.logout);
  const refreshUserState = useUserStore((state) => state.refreshUserState);

  const hasUserStateFailure =
    !!currentUserScope && userStateInitializationFailure?.scope === currentUserScope;
  const hasOwnerMismatch =
    hasUserStateFailure && userStateInitializationFailure?.reason === 'owner-mismatch';
  const hasUnresolvedAuthenticatedScope = isAuthLoaded && !!isLogin && !currentUserScope;
  const hasPendingAuthenticatedBootstrap =
    !!currentUserScope &&
    currentUserScope.startsWith('user:') &&
    (!isUserStateInit || userStateScope !== currentUserScope) &&
    !hasUserStateFailure;
  const isRetryingCurrentScope = !!currentUserScope && retryingScope === currentUserScope;

  const handleRetry = useCallback(async () => {
    if (!currentUserScope || hasOwnerMismatch || !hasUserStateFailure) return;

    const requestedScope = currentUserScope;
    setRetryingScope(requestedScope);
    try {
      await refreshUserState();
    } catch {
      // The user store exposes request failures through userStateInitializationFailure.
    } finally {
      setRetryingScope((activeRetryScope) =>
        activeRetryScope === requestedScope ? undefined : activeRetryScope,
      );
    }
  }, [currentUserScope, hasOwnerMismatch, hasUserStateFailure, refreshUserState]);

  const handleSignInAgain = useCallback(async () => {
    await logout();
  }, [logout]);

  if (!userStateDependentTabs.has(tab)) {
    return children;
  }

  if (!isAuthLoaded || isRetryingCurrentScope || hasPendingAuthenticatedBootstrap) {
    return <Loading />;
  }

  if (!hasUserStateFailure && !hasUnresolvedAuthenticatedScope) return children;

  const requiresSignInAgain = hasOwnerMismatch || hasUnresolvedAuthenticatedScope;

  return (
    <Center height={'100%'} padding={16} width={'100%'}>
      <Alert
        action={
          requiresSignInAgain ? (
            <Button icon={LogIn} onClick={handleSignInAgain} size={'small'} type={'primary'}>
              {t('bootstrapFailure.signInAgain')}
            </Button>
          ) : (
            <Button icon={RefreshCw} onClick={handleRetry} size={'small'} type={'primary'}>
              {t('bootstrapFailure.retry')}
            </Button>
          )
        }
        description={t(
          hasOwnerMismatch
            ? 'bootstrapFailure.ownerMismatchDescription'
            : hasUnresolvedAuthenticatedScope
              ? 'bootstrapFailure.accountDescription'
              : 'bootstrapFailure.description',
        )}
        message={t('bootstrapFailure.title')}
        showIcon
        type={'error'}
      />
    </Center>
  );
});

interface SettingsContentProps {
  activeTab?: string;
  mobile?: boolean;
  showLLM?: boolean;
}

const SettingsContent = ({ mobile, activeTab, showLLM = true }: SettingsContentProps) => {
  const shouldRenderLLMTabs = (tab: string) => {
    const isLLMTab = tab === SettingsTabs.Provider || tab === SettingsTabs.Agent;
    return showLLM || !isLLMTab;
  };
  if (activeTab && !shouldRenderLLMTabs(activeTab)) {
    notFound();
  }
  const renderComponent = (tab: string) => {
    const Component = componentMap[tab as keyof typeof componentMap] || componentMap.common;
    if (!Component) return null;

    const componentProps: { mobile?: boolean } = {};
    if (
      [SettingsTabs.About, SettingsTabs.Agent, SettingsTabs.Provider, SettingsTabs.Skills].includes(
        tab as any,
      )
    ) {
      componentProps.mobile = mobile;
    }

    return (
      <UserStateBootstrapGuard tab={tab}>
        <Component {...componentProps} />
      </UserStateBootstrapGuard>
    );
  };

  if (mobile) {
    return activeTab ? renderComponent(activeTab) : renderComponent(SettingsTabs.Common);
  }

  const getDisplayStyle = (tabName: string): CSSProperties => ({
    alignItems: 'center',
    display: activeTab === tabName ? 'flex' : 'none',
    flexDirection: 'column',
    gap: 64,
    height: '100%',
    paddingBlock:
      [SettingsTabs.Agent, SettingsTabs.Provider].includes(tabName as any) || mobile ? 0 : 24,
    paddingInline:
      [SettingsTabs.Agent, SettingsTabs.Provider].includes(tabName as any) || mobile ? 0 : 32,
    width: '100%',
  });

  return (
    <Flexbox height={'100%'} width={'100%'}>
      {Object.keys(componentMap).map((tabKey) => {
        if (!shouldRenderLLMTabs(tabKey)) return null;
        return (
          <div key={tabKey} style={getDisplayStyle(tabKey)}>
            {activeTab === tabKey && renderComponent(tabKey)}
          </div>
        );
      })}
    </Flexbox>
  );
};

export default SettingsContent;
