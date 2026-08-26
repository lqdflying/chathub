import { describe, expect, it } from 'vitest';

import {
  MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX,
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_MAX_VAR,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayMaxWidth,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

describe('mobile overlay width helpers', () => {
  it('exposes the compact card constants and gutter-capped max-width formula', () => {
    expect(MOBILE_ACTION_OVERLAY_GUTTER_PX).toBe(16);
    expect(MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX).toBe(320);
    expect(MOBILE_ACTION_OVERLAY_ROOT_CLASS).toBe('chathub-mobile-action-overlay');
    expect(MOBILE_ACTION_OVERLAY_MAX_VAR).toBe('--chathub-mobile-overlay-max');
    expect(getMobileActionOverlayMaxWidth()).toBe(
      `min(var(${MOBILE_ACTION_OVERLAY_MAX_VAR}, 100vw), calc(100vw - 32px))`,
    );
  });

  it('puts only the caller maxWidth CSS variable on the React style object', () => {
    expect(getMobileActionOverlayRootStyle()).toBeUndefined();
    expect(getMobileActionOverlayRootStyle(320)).toEqual({
      [MOBILE_ACTION_OVERLAY_MAX_VAR]: '320px',
    });
    expect(getMobileActionOverlayRootStyle('40vw')).toEqual({
      [MOBILE_ACTION_OVERLAY_MAX_VAR]: '40vw',
    });
    expect(getMobileActionOverlayRootStyle(320)).not.toHaveProperty('left');
    expect(getMobileActionOverlayRootStyle(320)).not.toHaveProperty('transform');
    expect(getMobileActionOverlayRootStyle(320)).not.toHaveProperty('maxWidth');
  });
});
