import type { Key } from 'swr';
import { mutate } from 'swr';

const ACCOUNT_CACHE_EPOCH_TAG = 'account-cache-epoch';

export type AccountCacheEpoch = readonly [typeof ACCOUNT_CACHE_EPOCH_TAG, number];

const isAccountScope = (value: unknown): value is string =>
  value === 'guest' ||
  value === 'local' ||
  (typeof value === 'string' && value.startsWith('user:') && value.length > 'user:'.length);

export const createAccountCacheKey = (
  key: Key,
  ownershipInvalidationGeneration: number,
): Key => {
  if (!Array.isArray(key)) return key;

  return [
    ...key,
    [ACCOUNT_CACHE_EPOCH_TAG, ownershipInvalidationGeneration] satisfies AccountCacheEpoch,
  ];
};

export const getAccountScopeFromKey = (key: Key): string | undefined => {
  if (!Array.isArray(key)) return;

  const accountScope = key[1];
  return isAccountScope(accountScope) ? accountScope : undefined;
};

export const isAccountCacheKey = (key: unknown): boolean => {
  if (!Array.isArray(key)) return false;

  const epoch = key.at(-1);
  return (
    Array.isArray(epoch) &&
    epoch[0] === ACCOUNT_CACHE_EPOCH_TAG &&
    typeof epoch[1] === 'number'
  );
};

export const clearAccountCache = async (): Promise<void> => {
  await mutate(isAccountCacheKey, undefined, { revalidate: false });
};
