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

  it('pushes one detail entry and does not pass Next history bypass flags', () => {
    window.history.replaceState(
      { _N: true, __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['settings'] },
      '',
      '/settings?active=provider',
    );

    expect(providerSelectHistoryMode(true)).toBe('push');
    const preserved = pushProviderDetailEntry('openai');
    const length = window.history.length;

    expect(preserved).toMatchObject({
      __PRIVATE_NEXTJS_INTERNALS_TREE: ['settings'],
      chathubProviderDetail: 'openai',
    });
    expect(preserved).not.toHaveProperty('__NA');
    expect(preserved).not.toHaveProperty('_N');
    expect(window.location.search).toContain('provider=openai');
    expect(readProviderDetailEntry()).toBe('openai');
    expect(window.history.state).not.toHaveProperty('__NA');

    const replaced = pushProviderDetailEntry('moonshot');

    expect(window.history.length).toBe(length);
    expect(replaced).toMatchObject({ chathubProviderDetail: 'moonshot' });
    expect(replaced).not.toHaveProperty('__NA');
    expect(readProviderDetailEntry()).toBe('moonshot');
    expect(window.location.search).toContain('provider=moonshot');
  });

  it('does not push a history entry for desktop selection', () => {
    expect(providerSelectHistoryMode(false)).toBe('replace');
    expect(providerSelectHistoryMode(undefined)).toBe('replace');
    expect(readProviderDetailEntry()).toBeNull();
  });

  it('restores the detail marker after a query update clears history.state', () => {
    window.history.replaceState(
      { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['settings'] },
      '',
      '/settings?active=provider',
    );
    const preserved = pushProviderDetailEntry('openai');
    expect(preserved).not.toBeNull();
    window.history.replaceState(null, '', window.location.href);

    retainProviderDetailEntry('openai', preserved!);

    expect(readProviderDetailEntry()).toBe('openai');
    expect(window.history.state).toMatchObject({
      __PRIVATE_NEXTJS_INTERNALS_TREE: ['settings'],
    });
    expect(window.history.state).not.toHaveProperty('__NA');
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
