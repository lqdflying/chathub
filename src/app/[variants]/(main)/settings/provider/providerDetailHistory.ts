const PROVIDER_DETAIL_HISTORY_KEY = 'chathubProviderDetail';

export type ProviderHistoryMode = 'push' | 'replace';

const copyHistoryState = (): Record<string, unknown> => {
  const state = window.history.state;
  if (state && typeof state === 'object') return { ...state };
  return {};
};

export const providerSelectHistoryMode = (mobile?: boolean): ProviderHistoryMode =>
  mobile ? 'push' : 'replace';

export const readProviderDetailEntry = (): string | null => {
  const state = window.history.state;
  if (!state || typeof state !== 'object') return null;
  const providerId = (state as Record<string, unknown>)[PROVIDER_DETAIL_HISTORY_KEY];
  return typeof providerId === 'string' && providerId ? providerId : null;
};

const detailPath = (providerId: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set('active', 'provider');
  url.searchParams.set('provider', providerId);
  return `${url.pathname}${url.search}${url.hash}`;
};

// Returns the state written onto the new entry, or null when the browser
// refuses the push. Callers must not history.back() without that entry.
export const pushProviderDetailEntry = (providerId: string): Record<string, unknown> | null => {
  const state = { ...copyHistoryState(), [PROVIDER_DETAIL_HISTORY_KEY]: providerId };
  try {
    window.history.pushState(state, '', detailPath(providerId));
  } catch {
    return null;
  }
  return state;
};

// nuqs commits query updates with history.state = null. Put the marker back
// only while this document is still the detail entry from that selection.
export const retainProviderDetailEntry = (
  providerId: string,
  preservedState: Record<string, unknown>,
) => {
  if (new URLSearchParams(window.location.search).get('provider') !== providerId) return;
  const state = {
    ...preservedState,
    ...copyHistoryState(),
    [PROVIDER_DETAIL_HISTORY_KEY]: providerId,
  };
  window.history.replaceState(state, '', window.location.href);
};
