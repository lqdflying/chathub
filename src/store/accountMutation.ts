import type { UserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export interface AccountMutationSnapshot {
  ownershipInvalidationGeneration: number;
  scope: string;
}

export const captureAccountMutationSnapshot = (
  state: UserStore,
): AccountMutationSnapshot | undefined => {
  const scope = authSelectors.currentUserScope(state);
  if (!scope || authSelectors.hasActiveUserStateOwnerMismatch(state)) return undefined;

  return {
    ownershipInvalidationGeneration: state.ownershipInvalidationGeneration,
    scope,
  };
};

export const isAccountMutationCurrent = (
  state: UserStore,
  snapshot: AccountMutationSnapshot,
): boolean =>
  authSelectors.currentUserScope(state) === snapshot.scope &&
  state.ownershipInvalidationGeneration === snapshot.ownershipInvalidationGeneration &&
  !authSelectors.hasActiveUserStateOwnerMismatch(state);
