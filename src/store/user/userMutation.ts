import type { UserStore } from '@/store/user';

import { authSelectors } from './slices/auth/selectors';

export interface UserMutationSnapshot {
  ownerId?: string;
  ownershipInvalidationGeneration: number;
  scope: string;
}

export const captureUserMutationSnapshot = (state: UserStore): UserMutationSnapshot => {
  const scope = authSelectors.currentUserScope(state);
  if (!scope || authSelectors.hasActiveUserStateOwnerMismatch(state)) {
    throw new TypeError('User state ownership is not active');
  }

  return {
    ownerId: state.user?.id,
    ownershipInvalidationGeneration: state.ownershipInvalidationGeneration,
    scope,
  };
};

export const isUserMutationCurrent = (
  state: UserStore,
  snapshot: UserMutationSnapshot,
): boolean =>
  authSelectors.currentUserScope(state) === snapshot.scope &&
  state.user?.id === snapshot.ownerId &&
  state.ownershipInvalidationGeneration === snapshot.ownershipInvalidationGeneration &&
  !authSelectors.hasActiveUserStateOwnerMismatch(state);
