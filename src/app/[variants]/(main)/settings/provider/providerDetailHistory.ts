export type ProviderHistoryMode = 'push' | 'replace';

// In-memory so a reloaded or bookmarked detail URL does not history.back()
// out of Settings. The iOS edge swipe only walks real history entries.
let providerDetailHistoryPushed = false;

export const providerSelectHistoryMode = (mobile?: boolean): ProviderHistoryMode =>
  mobile ? 'push' : 'replace';

export const markProviderDetailHistoryPush = () => {
  providerDetailHistoryPushed = true;
};

export const consumeProviderDetailHistoryPush = () => {
  const pushed = providerDetailHistoryPushed;
  providerDetailHistoryPushed = false;
  return pushed;
};

export const resetProviderDetailHistoryPush = () => {
  providerDetailHistoryPushed = false;
};

export const selectProviderHistory = (mobile?: boolean): ProviderHistoryMode => {
  const history = providerSelectHistoryMode(mobile);
  if (history === 'push') markProviderDetailHistoryPush();
  return history;
};

export const syncProviderDetailHistoryOnPop = (provider: string | null) => {
  if (!provider || provider === 'all') resetProviderDetailHistoryPush();
};
