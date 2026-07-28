'use client';

import { Alert, Button } from '@lobehub/ui';
import { LogIn, RefreshCw } from 'lucide-react';
import { ReactNode, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center } from 'react-layout-kit';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import SkeletonList from '../SkeletonList';

interface AssistantListBootstrapGuardProps {
  children: ReactNode;
}

const AssistantListBootstrapGuard = memo<AssistantListBootstrapGuardProps>(({ children }) => {
  const { t } = useTranslation('chat');
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

  if (isRetryingCurrentScope || hasPendingAuthenticatedBootstrap) return <SkeletonList />;

  if (!hasUserStateFailure && !hasUnresolvedAuthenticatedScope) return children;

  const requiresSignInAgain = hasOwnerMismatch || hasUnresolvedAuthenticatedScope;

  return (
    <Center padding={12} width={'100%'}>
      <Alert
        action={
          requiresSignInAgain ? (
            <Button icon={LogIn} onClick={handleSignInAgain} size={'small'} type={'primary'}>
              {t('sessionBootstrapFailure.signInAgain')}
            </Button>
          ) : (
            <Button icon={RefreshCw} onClick={handleRetry} size={'small'} type={'primary'}>
              {t('sessionBootstrapFailure.retry')}
            </Button>
          )
        }
        description={t(
          hasOwnerMismatch
            ? 'sessionBootstrapFailure.ownerMismatchDescription'
            : hasUnresolvedAuthenticatedScope
              ? 'sessionBootstrapFailure.accountDescription'
              : 'sessionBootstrapFailure.description',
        )}
        message={t('sessionBootstrapFailure.title')}
        showIcon
        type={'error'}
      />
    </Center>
  );
});

AssistantListBootstrapGuard.displayName = 'AssistantListBootstrapGuard';

export default AssistantListBootstrapGuard;
