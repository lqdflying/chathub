import { describe, expect, it } from 'vitest';

import {
  MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX,
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_MAX_VAR,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayInnerStyle,
  getMobileActionOverlayMaxWidth,
  getMobileActionOverlayRootStyle,
  getMobileActionOverlayViewportMaxWidth,
} from './mobileOverlayWidth';

describe('getMobileActionOverlayRootStyle', () => {
  it('sizes the overlay to max-content, caps it to 16px gutters, and centers with translate', () => {
    expect(MOBILE_ACTION_OVERLAY_GUTTER_PX).toBe(16);
    expect(MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX).toBe(320);
    expect(MOBILE_ACTION_OVERLAY_ROOT_CLASS).toBe('chathub-mobile-action-overlay');
    expect(getMobileActionOverlayViewportMaxWidth()).toBe('calc(100vw - 32px)');
    expect(getMobileActionOverlayMaxWidth()).toBe(
      `min(var(${MOBILE_ACTION_OVERLAY_MAX_VAR}, 100vw), calc(100vw - 32px))`,
    );
    expect(getMobileActionOverlayRootStyle()).toEqual({
      boxSizing: 'border-box',
      left: '50%',
      maxWidth: getMobileActionOverlayMaxWidth(),
      right: 'auto',
      translate: '-50% 0',
      width: 'max-content',
    });
    expect(getMobileActionOverlayRootStyle()).not.toHaveProperty('transform');
  });

  it('exposes caller maxWidth on the CSS variable used by the important root cap', () => {
    expect(getMobileActionOverlayRootStyle(320)).toMatchObject({
      [MOBILE_ACTION_OVERLAY_MAX_VAR]: '320px',
      maxWidth: getMobileActionOverlayMaxWidth(),
    });
  });
});

describe('getMobileActionOverlayInnerStyle', () => {
  it('does not force an important 100% max-width over the caller cap', () => {
    expect(getMobileActionOverlayInnerStyle()).toEqual({
      boxSizing: 'border-box',
      maxWidth: '100%',
      width: 'auto',
    });
  });
});
