import type { UserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export interface AccountMutationSnapshot {
  ownershipInvalidationGeneration: number;
  scope: string;
}

export const hasVerifiedAccountOwnership = (state: UserStore, scope: string): boolean => {
  if (authSelectors.hasActiveUserStateOwnerMismatch(state)) return false;
  if (!scope.startsWith('user:')) return true;

  return state.isUserStateInit && state.userStateScope === scope;
};

export const captureAccountMutationSnapshot = (
  state: UserStore,
): AccountMutationSnapshot | undefined => {
  const scope = authSelectors.currentUserScope(state);
  if (!scope || !hasVerifiedAccountOwnership(state, scope)) return undefined;

  return {
    ownershipInvalidationGeneration: state.ownershipInvalidationGeneration,
    scope,
  };
};

export const captureSensitiveAccountMutationSnapshot = (
  state: UserStore,
): AccountMutationSnapshot | undefined => {
  const snapshot = captureAccountMutationSnapshot(state);
  if (!snapshot || snapshot.scope === 'guest') return undefined;

  return snapshot;
};

export const sensitiveAccountScope = (state: UserStore): string | undefined =>
  captureSensitiveAccountMutationSnapshot(state)?.scope;

export const isAccountMutationCurrent = (
  state: UserStore,
  snapshot: AccountMutationSnapshot,
): boolean =>
  authSelectors.currentUserScope(state) === snapshot.scope &&
  state.ownershipInvalidationGeneration === snapshot.ownershipInvalidationGeneration &&
  hasVerifiedAccountOwnership(state, snapshot.scope);
