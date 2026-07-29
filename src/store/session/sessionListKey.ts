export const FETCH_SESSIONS_KEY = 'fetchSessions';

export type SessionListBaseKey = readonly [typeof FETCH_SESSIONS_KEY, string, number, number];

export const createSessionListBaseKey = (
  scope: string,
  ownershipInvalidationGeneration: number,
  scopeGeneration: number,
): SessionListBaseKey => [
  FETCH_SESSIONS_KEY,
  scope,
  ownershipInvalidationGeneration,
  scopeGeneration,
];

export const isSessionListCacheKey = (key: readonly unknown[], requestedScope: string): boolean =>
  key.length === 5 &&
  key[0] === FETCH_SESSIONS_KEY &&
  key[1] === requestedScope &&
  typeof key[2] === 'number' &&
  typeof key[3] === 'number';
