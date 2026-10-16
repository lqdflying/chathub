import { afterEach, describe, expect, it } from 'vitest';

import {
  providerSelectHistoryMode,
  pushProviderDetailEntry,
  readProviderDetailEntry,
  retainProviderDetailEntry,
} from './providerDetailHistory';

describe('provider detail history', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/settings?active=provider');
  });

  it('pushes a mobile detail entry without dropping the previous history state', () => {
    window.history.replaceState({ __NA: true }, '', '/settings?active=provider');

    expect(providerSelectHistoryMode(true)).toBe('push');
    const preserved = pushProviderDetailEntry('openai');

    expect(preserved).toMatchObject({ __NA: true, chathubProviderDetail: 'openai' });
    expect(window.location.search).toContain('provider=openai');
    expect(readProviderDetailEntry()).toBe('openai');
    expect(window.history.state).toMatchObject({ __NA: true, chathubProviderDetail: 'openai' });
  });

  it('does not push a history entry for desktop selection', () => {
    expect(providerSelectHistoryMode(false)).toBe('replace');
    expect(providerSelectHistoryMode(undefined)).toBe('replace');
    expect(readProviderDetailEntry()).toBeNull();
  });

  it('restores the detail marker after a query update clears history.state', () => {
    window.history.replaceState({ __NA: true }, '', '/settings?active=provider');
    const preserved = pushProviderDetailEntry('openai');
    expect(preserved).not.toBeNull();
    window.history.replaceState(null, '', window.location.href);

    retainProviderDetailEntry('openai', preserved!);

    expect(readProviderDetailEntry()).toBe('openai');
    expect(window.history.state).toMatchObject({ __NA: true });
  });

  it('does not stamp the list entry when the detail update was cancelled', () => {
    window.history.replaceState({ __NA: true }, '', '/settings?active=provider');
    const preserved = pushProviderDetailEntry('openai');
    expect(preserved).not.toBeNull();
    window.history.back();

    retainProviderDetailEntry('openai', preserved!);

    expect(new URLSearchParams(window.location.search).get('provider')).toBeNull();
    expect(readProviderDetailEntry()).toBeNull();
  });

  it('keeps the marker when Forward returns to the pushed detail entry', () => {
    window.history.replaceState(null, '', '/settings?active=provider');
    pushProviderDetailEntry('openai');
    window.history.back();
    expect(readProviderDetailEntry()).toBeNull();

    window.history.forward();

    expect(readProviderDetailEntry()).toBe('openai');
    expect(window.location.search).toContain('provider=openai');
  });
});
