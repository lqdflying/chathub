const SESSION_TRANSITION_LOCK_NAME = 'chathub-next-auth-session-transition';
export const NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY = 'chathub:next-auth-session-transition';
export const NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT =
  'chathub:next-auth-session-transition-completed';
const SESSION_TRANSITION_GENERATION_STORAGE_KEY = 'chathub:next-auth-session-transition-generation';
const SESSION_TRANSITION_OWNER_STORAGE_KEY = 'chathub:next-auth-session-transition-owner';
const AUTH_JS_OAUTH_TRANSACTION_LIFETIME_MS = 15 * 60 * 1000;

// Auth.js refreshes useSession before redirect:false returns. Keep this
// document from treating that old-account refresh as callback completion.
let activeRedirectingOAuthMarker: string | undefined;

const createTransitionMarker = (): string =>
  JSON.stringify({
    createdAt: Date.now(),
    id: crypto.randomUUID(),
  });

type StoredValueResult =
  { available: false; value: null } | { available: true; value: null | string };

const readStoredValue = (key: string): StoredValueResult => {
  try {
    return { available: true, value: localStorage.getItem(key) };
  } catch {
    return { available: false, value: null };
  }
};

const getStoredValue = (key: string): null | string => readStoredValue(key).value;

const setStoredValue = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Session transitions continue without cross-document coordination when storage is unavailable.
    return false;
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

const startNextAuthSessionTransition = (): {
  marker: string;
  markerWasStored: boolean;
} => {
  const marker = createTransitionMarker();
  const nextGeneration = getNextAuthSessionTransitionGeneration() + 1;
  const markerWasStored = setStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY, marker);

  setStoredValue(SESSION_TRANSITION_GENERATION_STORAGE_KEY, String(nextGeneration));
  setOwnedTransitionMarker(marker);
  return { marker, markerWasStored };
};

export const beginNextAuthSessionTransition = (): string => startNextAuthSessionTransition().marker;

const extendNextAuthSessionTransition = (
  marker: string,
  markerWasStored: boolean,
): string | undefined => {
  const storedMarker = readStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY);
  const wasSuperseded = markerWasStored && storedMarker.available && storedMarker.value !== marker;

  if (wasSuperseded) {
    removeOwnedTransitionMarker(marker);
    if (activeRedirectingOAuthMarker === marker) activeRedirectingOAuthMarker = undefined;
    return;
  }

  const extendedMarker = createTransitionMarker();
  const nextGeneration = getNextAuthSessionTransitionGeneration() + 1;
  const extendedMarkerWasStored = setStoredValue(
    NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY,
    extendedMarker,
  );

  if (!extendedMarkerWasStored) {
    removeOwnedTransitionMarker(marker);
    setOwnedTransitionMarker(extendedMarker);
    if (activeRedirectingOAuthMarker === marker) {
      activeRedirectingOAuthMarker = extendedMarker;
    }
    return extendedMarker;
  }

  setStoredValue(SESSION_TRANSITION_GENERATION_STORAGE_KEY, String(nextGeneration));
  removeOwnedTransitionMarker(marker);
  setOwnedTransitionMarker(extendedMarker);
  if (activeRedirectingOAuthMarker === marker) {
    activeRedirectingOAuthMarker = extendedMarker;
  }
  return extendedMarker;
};

export const completeNextAuthSessionTransition = (marker: string): void => {
  if (getStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY) === marker) {
    removeStoredValue(NEXT_AUTH_SESSION_TRANSITION_STORAGE_KEY);
  }
  removeOwnedTransitionMarker(marker);
  if (activeRedirectingOAuthMarker === marker) activeRedirectingOAuthMarker = undefined;
};

export const completeOwnedNextAuthSessionTransition = (): void => {
  const ownedMarker = getOwnedTransitionMarker();
  if (!ownedMarker) return;
  if (activeRedirectingOAuthMarker === ownedMarker) return;

  completeNextAuthSessionTransition(ownedMarker);
  window.dispatchEvent(new Event(NEXT_AUTH_SESSION_TRANSITION_COMPLETED_EVENT));
};

export const isNextAuthSessionTransitionPending = (): boolean => {
  const activeOAuthTransitionCreatedAt = getTransitionCreatedAt(
    activeRedirectingOAuthMarker ?? null,
  );
  if (
    activeOAuthTransitionCreatedAt !== undefined &&
    Date.now() - activeOAuthTransitionCreatedAt <= AUTH_JS_OAUTH_TRANSACTION_LIFETIME_MS
  ) {
    return true;
  }
  activeRedirectingOAuthMarker = undefined;

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

export const runRedirectingNextAuthOAuthTransition = async (
  operation: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  const startedTransition = startNextAuthSessionTransition();
  let marker = startedTransition.marker;
  activeRedirectingOAuthMarker = marker;

  try {
    const establishOAuthTransaction = async (): Promise<string | undefined> => {
      const redirectUrl = await operation();
      if (!redirectUrl) {
        completeNextAuthSessionTransition(marker);
        return;
      }

      const extendedMarker = extendNextAuthSessionTransition(
        marker,
        startedTransition.markerWasStored,
      );
      if (!extendedMarker) return;

      marker = extendedMarker;
      return redirectUrl;
    };

    return navigator.locks
      ? await navigator.locks.request(SESSION_TRANSITION_LOCK_NAME, establishOAuthTransaction)
      : await establishOAuthTransaction();
  } catch (error) {
    completeNextAuthSessionTransition(marker);
    throw error;
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    activeRedirectingOAuthMarker = undefined;
  });
}
