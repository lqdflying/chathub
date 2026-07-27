import type { UserStore } from '@/store/user';

export type UserStoreSetter = (
  partial:
    | Partial<UserStore>
    | ((state: UserStore) => Partial<UserStore>),
  replace?: false,
  action?: string,
) => void;

export const createTrackedUserMutationController = (
  set: UserStoreSetter,
  action: string,
): AbortController => {
  const abortController = new AbortController();
  set(
    (state) => ({
      userMutationAbortControllers: [...state.userMutationAbortControllers, abortController],
    }),
    false,
    `${action}/track`,
  );

  return abortController;
};

export const releaseTrackedUserMutationController = (
  set: UserStoreSetter,
  abortController: AbortController,
  action: string,
): void => {
  set(
    (state) => ({
      userMutationAbortControllers: state.userMutationAbortControllers.filter(
        (controller) => controller !== abortController,
      ),
    }),
    false,
    `${action}/release`,
  );
};
