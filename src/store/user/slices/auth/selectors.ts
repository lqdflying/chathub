import { BRANDING_NAME, isDesktop } from '@lobechat/const';
import { LobeUser } from '@lobechat/types';
import { t } from 'i18next';

import { enableAuth, enableClerk, enableNextAuth } from '@/const/auth';
import type { UserStore } from '@/store/user';

const DEFAULT_USERNAME = BRANDING_NAME;

const nickName = (s: UserStore) => {
  const defaultNickName = s.user?.fullName || s.user?.username;
  if (!enableAuth) {
    if (isDesktop) {
      return defaultNickName;
    }
    return t('userPanel.defaultNickname', { ns: 'common' });
  }

  if (s.isSignedIn) return defaultNickName;

  return t('userPanel.anonymousNickName', { ns: 'common' });
};

const username = (s: UserStore) => {
  if (!enableAuth) {
    if (isDesktop) {
      return s.user?.username;
    }
    return DEFAULT_USERNAME;
  }

  if (s.isSignedIn) return s.user?.username;

  return 'anonymous';
};

export const userProfileSelectors = {
  displayUserName: (s: UserStore): string => username(s) || s.user?.email || '',
  email: (s: UserStore): string => s.user?.email || '',
  fullName: (s: UserStore): string => s.user?.fullName || '',
  nickName,
  userAvatar: (s: UserStore): string => s.user?.avatar || '',
  userId: (s: UserStore) => s.user?.id,
  userProfile: (s: UserStore): LobeUser | null | undefined => s.user,
  username,
};

/**
 * 使用此方法可以兼容不需要登录鉴权的情况
 */
const isLogin = (s: UserStore) => {
  // 如果没有开启鉴权，说明不需要登录，默认是登录态
  if (!enableAuth) return true;

  return s.isSignedIn;
};

const currentUserScope = (s: UserStore): string | undefined => {
  if (!enableAuth) return 'local';
  if (!s.isLoaded || s.isSignedIn === undefined) return undefined;
  if (!s.isSignedIn) return 'guest';

  const authenticatedUserId = s.authUserId || s.user?.id;
  return authenticatedUserId ? `user:${authenticatedUserId}` : undefined;
};

const hasActiveUserStateOwnerMismatch = (s: UserStore): boolean => {
  const userScope = currentUserScope(s);
  const initializationFailure = s.userStateInitializationFailure;

  return (
    !!userScope &&
    initializationFailure?.scope === userScope &&
    initializationFailure.reason === 'owner-mismatch'
  );
};

export type AssistantCreationStatus =
  'owner-mismatch' | 'pending' | 'ready' | 'request-failed' | 'unresolved-authenticated-scope';

const assistantCreationStatus = (s: UserStore): AssistantCreationStatus => {
  const userScope = currentUserScope(s);
  const currentScopeFailure =
    userScope && s.userStateInitializationFailure?.scope === userScope
      ? s.userStateInitializationFailure
      : undefined;

  if (currentScopeFailure) return currentScopeFailure.reason;

  if (!userScope) {
    const hasUnresolvedAuthenticatedScope = s.isLoaded && !!isLogin(s);
    return hasUnresolvedAuthenticatedScope ? 'unresolved-authenticated-scope' : 'pending';
  }

  if (userScope.startsWith('user:') && (!s.isUserStateInit || s.userStateScope !== userScope)) {
    return 'pending';
  }

  return 'ready';
};

export const authSelectors = {
  assistantCreationStatus,
  canCreateAssistant: (s: UserStore): boolean => assistantCreationStatus(s) === 'ready',
  currentUserScope,
  hasActiveUserStateOwnerMismatch,
  isLoaded: (s: UserStore) => s.isLoaded,
  isLogin,
  isLoginWithAuth: (s: UserStore) => s.isSignedIn,
  isLoginWithClerk: (s: UserStore): boolean => (s.isSignedIn && enableClerk) || false,
  isLoginWithNextAuth: (s: UserStore): boolean => (s.isSignedIn && !!enableNextAuth) || false,
};
