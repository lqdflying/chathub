import { describe, expect, it } from 'vitest';

import {
  MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX,
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayInnerStyle,
  getMobileActionOverlayMaxWidth,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

describe('getMobileActionOverlayRootStyle', () => {
  it('sizes the overlay to max-content, caps it to 16px gutters, and centers it', () => {
    expect(MOBILE_ACTION_OVERLAY_GUTTER_PX).toBe(16);
    expect(MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX).toBe(320);
    expect(MOBILE_ACTION_OVERLAY_ROOT_CLASS).toBe('chathub-mobile-action-overlay');
    expect(getMobileActionOverlayMaxWidth()).toBe('calc(100vw - 32px)');
    expect(getMobileActionOverlayRootStyle()).toEqual({
      boxSizing: 'border-box',
      left: '50%',
      maxWidth: 'calc(100vw - 32px)',
      right: 'auto',
      transform: 'translateX(-50%)',
      width: 'max-content',
    });
  });
});

describe('getMobileActionOverlayInnerStyle', () => {
  it('fills the content-sized root without forcing 100vw', () => {
    expect(getMobileActionOverlayInnerStyle()).toEqual({
      boxSizing: 'border-box',
      maxWidth: '100%',
      width: 'auto',
    });
  });
});
