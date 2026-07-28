import type { UserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export type AssistantListBootstrapStatus =
  'owner-mismatch' | 'pending' | 'ready' | 'request-failed' | 'unresolved-authenticated-scope';

export const getAssistantListBootstrapStatus = (state: UserStore): AssistantListBootstrapStatus => {
  const currentUserScope = authSelectors.currentUserScope(state);
  const currentScopeFailure =
    currentUserScope && state.userStateInitializationFailure?.scope === currentUserScope
      ? state.userStateInitializationFailure
      : undefined;

  if (currentScopeFailure) return currentScopeFailure.reason;

  if (!currentUserScope) {
    const hasUnresolvedAuthenticatedScope =
      authSelectors.isLoaded(state) && !!authSelectors.isLogin(state);

    return hasUnresolvedAuthenticatedScope ? 'unresolved-authenticated-scope' : 'pending';
  }

  if (
    currentUserScope.startsWith('user:') &&
    (!state.isUserStateInit || state.userStateScope !== currentUserScope)
  ) {
    return 'pending';
  }

  return 'ready';
};
