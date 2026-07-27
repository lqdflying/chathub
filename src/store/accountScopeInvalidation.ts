export interface AccountScopeInvalidation {
  generation: number;
  scope: string;
}

type AccountScopeInvalidationListener = (invalidation: AccountScopeInvalidation) => void;

const accountScopeInvalidationListeners = new Set<AccountScopeInvalidationListener>();

export const publishAccountScopeInvalidation = (invalidation: AccountScopeInvalidation): void => {
  for (const listener of accountScopeInvalidationListeners) {
    listener(invalidation);
  }
};

export const subscribeAccountScopeInvalidation = (
  listener: AccountScopeInvalidationListener,
): (() => void) => {
  accountScopeInvalidationListeners.add(listener);

  return () => {
    accountScopeInvalidationListeners.delete(listener);
  };
};
