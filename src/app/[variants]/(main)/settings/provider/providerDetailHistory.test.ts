import { afterEach, describe, expect, it } from 'vitest';

import {
  consumeProviderDetailHistoryPush,
  markProviderDetailHistoryPush,
  providerSelectHistoryMode,
  resetProviderDetailHistoryPush,
  selectProviderHistory,
  syncProviderDetailHistoryOnPop,
} from './providerDetailHistory';

describe('provider detail history', () => {
  afterEach(() => {
    resetProviderDetailHistoryPush();
  });

  it('pushes a history entry and marks it when a mobile provider is selected', () => {
    expect(providerSelectHistoryMode(true)).toBe('push');
    expect(selectProviderHistory(true)).toBe('push');
    expect(consumeProviderDetailHistoryPush()).toBe(true);
  });

  it('replaces history and does not mark a desktop provider selection', () => {
    expect(providerSelectHistoryMode(false)).toBe('replace');
    expect(selectProviderHistory(false)).toBe('replace');
    expect(selectProviderHistory(undefined)).toBe('replace');
    expect(consumeProviderDetailHistoryPush()).toBe(false);
  });

  it('clears the mark when popstate lands on the provider list', () => {
    markProviderDetailHistoryPush();
    syncProviderDetailHistoryOnPop(null);
    expect(consumeProviderDetailHistoryPush()).toBe(false);

    markProviderDetailHistoryPush();
    syncProviderDetailHistoryOnPop('all');
    expect(consumeProviderDetailHistoryPush()).toBe(false);
  });

  it('keeps the mark when popstate stays on a provider detail', () => {
    markProviderDetailHistoryPush();
    syncProviderDetailHistoryOnPop('openai');
    expect(consumeProviderDetailHistoryPush()).toBe(true);
  });
});
