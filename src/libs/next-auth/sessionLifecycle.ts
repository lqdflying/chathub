const SESSION_TRANSITION_LOCK_NAME = 'chathub-next-auth-session-transition';
export const NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY = 'chathub:next-auth-session-transition';
export const NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT =
  'chathub:next-auth-session-transition-completed';
const SESSION_TRANSITION_GENERATION_STORAGE_KEY = 'chathub:next-auth-session-transition-generation';
const SESSION_TRANSITION_OWNER_STORAGE_KEY = 'chathub:next-auth-session-transition-owner';
const AUTH_JS_OAUTH_TRANSACTION_LIFETIME_MS = 15 * 60 * 1000;

const createTransitionMarker = (): string =>
  JSON.stringify({
    createdAt: Date.now(),
    id: crypto.randomUUID(),
  });

const getStoredValue = (key: string): null | string => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStoredValue = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Session transitions continue without cross-document coordination when storage is unavailable.
  }
};

const removeStoredValue = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Session transitions continue without cross-document coordination when storage is unavailable.
  }
};

const getOwnedTransitionMarker = (): null | string => {
  try {
    return sessionStorage.getItem(SESSION_TRANSITION_OWNER_STORAGE_KEY);
  } catch {
    return null;
  }
};

const setOwnedTransitionMarker = (marker: string): void => {
  try {
    sessionStorage.setItem(SESSION_TRANSITION_OWNER_STORAGE_KEY, marker);
  } catch {
    // The origin-wide marker still coordinates other documents when session storage is unavailable.
  }
};

const removeOwnedTransitionMarker = (marker: string): void => {
  try {
    if (sessionStorage.getItem(SESSION_TRANSITION_OWNER_STORAGE_KEY) === marker) {
      sessionStorage.removeItem(SESSION_TRANSITION_OWNER_STORAGE_KEY);
    }
  } catch {
    // The origin-wide marker still expires automatically when session storage is unavailable.
  }
};

const getTransitionCreatedAt = (marker: string | null): number | undefined => {
  if (!marker) return;

  try {
    const parsedMarker: unknown = JSON.parse(marker);
    if (!parsedMarker || typeof parsedMarker !== 'object' || !('createdAt' in parsedMarker)) return;

    const { createdAt } = parsedMarker as { createdAt?: unknown };
    return typeof createdAt === 'number' ? createdAt : undefined;
  } catch {
    return;
  }
};

export const getNextAuthSessionTransitionGeneration = (): number => {
  const storedGeneration = getStoredValue(SESSION_TRANSITION_GENERATION_STORAGE_KEY);
  const generation = Number(storedGeneration);

  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
};

export const beginNextAuthSessionTransition = (): string => {
  const marker = createTransitionMarker();
  const nextGeneration = getNextAuthSessionTransitionGeneration() + 1;

  setStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY, marker);
  setStoredValue(SESSION_TRANSITION_GENERATION_STORAGE_KEY, String(nextGeneration));
  setOwnedTransitionMarker(marker);
  return marker;
};

export const completeNextAuthSessionTransition = (marker: string): void => {
  if (getStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY) === marker) {
    removeStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY);
  }
  removeOwnedTransitionMarker(marker);
};

export const completeOwnedNextAuthSessionTransition = (): void => {
  const ownedMarker = getOwnedTransitionMarker();
  if (!ownedMarker) return;

  completeNextAuthSessionTransition(ownedMarker);
  window.dispatchEvent(new Event(NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT));
};

export const isNextAuthSessionTransitionPending = (): boolean => {
  const marker = getStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY);
  const createdAt = getTransitionCreatedAt(marker);

  if (createdAt === undefined || Date.now() - createdAt > AUTH_JS_OAUTH_TRANSACTION_LIFETIME_MS) {
    if (marker) removeStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY);
    return false;
  }

  return true;
};

export const runWithNextAuthSessionLock = async <Result>(
  operation: () => Promise<Result>,
): Promise<Result | undefined> => {
  if (!navigator.locks) return;

  return navigator.locks.request(SESSION_TRANSITION_LOCK_NAME, operation);
};

export const runNextAuthSessionTransition = async <Result>(
  operation: () => Promise<Result>,
): Promise<Result> => {
  const marker = beginNextAuthSessionTransition();

  try {
    if (!navigator.locks) return await operation();

    return await navigator.locks.request(SESSION_TRANSITION_LOCK_NAME, operation);
  } finally {
    completeNextAuthSessionTransition(marker);
  }
};

export const runRedirectingNextAuthSessionTransition = async <Result>(
  operation: () => Promise<Result>,
): Promise<Result> => {
  const marker = beginNextAuthSessionTransition();

  try {
    if (!navigator.locks) return await operation();

    return await navigator.locks.request(SESSION_TRANSITION_LOCK_NAME, operation);
  } catch (error) {
    completeNextAuthSessionTransition(marker);
    throw error;
  }
};
