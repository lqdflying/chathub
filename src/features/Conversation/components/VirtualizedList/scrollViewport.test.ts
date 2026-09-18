import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureSettledRowHeight,
  resolveFrozenRowMinHeight,
  resolveVirtuosoOverscan,
  shouldApplyLightScrollMarkdown,
} from './scrollViewport';

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

describe('captureSettledRowHeight', () => {
  it('records the idle height', () => {
    expect(captureSettledRowHeight(false, 420, 100)).toBe(420);
  });

  it('keeps the last idle height after light markdown turns on', () => {
    expect(captureSettledRowHeight(true, 80, 420)).toBe(420);
  });
});

describe('resolveFrozenRowMinHeight', () => {
  it('freezes the idle height while scrolling or holding restore', () => {
    expect(resolveFrozenRowMinHeight(true, 420)).toBe(420);
    expect(resolveFrozenRowMinHeight(false, 420)).toBeUndefined();
  });
});

describe('shouldApplyLightScrollMarkdown', () => {
  it('requires a known idle height so the placeholder can keep size', () => {
    expect(shouldApplyLightScrollMarkdown(true, 420)).toBe(true);
    expect(shouldApplyLightScrollMarkdown(true, undefined)).toBe(false);
    expect(shouldApplyLightScrollMarkdown(false, 420)).toBe(false);
  });
});
