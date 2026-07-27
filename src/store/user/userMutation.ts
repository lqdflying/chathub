import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
  type AccountMutationSnapshot,
} from '@/store/accountMutation';
import type { UserStore } from '@/store/user';

export interface UserMutationSnapshot extends AccountMutationSnapshot {
  ownerId?: string;
}

export const captureUserMutationSnapshot = (state: UserStore): UserMutationSnapshot => {
  const accountSnapshot = captureAccountMutationSnapshot(state);
  if (!accountSnapshot) {
    throw new TypeError('User state ownership is not active');
  }

  return {
    ...accountSnapshot,
    ownerId: state.user?.id,
  };
};

export const isUserMutationCurrent = (
  state: UserStore,
  snapshot: UserMutationSnapshot,
): boolean =>
  isAccountMutationCurrent(state, snapshot) && state.user?.id === snapshot.ownerId;
