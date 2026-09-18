import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveVirtuosoOverscan } from './scrollViewport';

describe('resolveVirtuosoOverscan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses one desktop viewport from visualViewport', () => {
    vi.stubGlobal('window', {
      innerHeight: 2000,
      visualViewport: { height: 800 },
    });

    expect(resolveVirtuosoOverscan(false)).toBe(800);
  });

  it('caps mobile overscan to half the visual viewport', () => {
    vi.stubGlobal('window', {
      innerHeight: 2000,
      visualViewport: { height: 600 },
    });

    expect(resolveVirtuosoOverscan(true)).toBe(300);
  });

  it('caps mobile overscan at 400px on a tall visual viewport', () => {
    vi.stubGlobal('window', {
      innerHeight: 2000,
      visualViewport: { height: 1200 },
    });

    expect(resolveVirtuosoOverscan(true)).toBe(400);
  });
});
