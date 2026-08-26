import { describe, expect, it } from 'vitest';

import {
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayInnerStyle,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

describe('getMobileActionOverlayRootStyle', () => {
  it('pins both physical edges to the 16px gutter and lets the root stretch', () => {
    expect(MOBILE_ACTION_OVERLAY_GUTTER_PX).toBe(16);
    expect(MOBILE_ACTION_OVERLAY_ROOT_CLASS).toBe('chathub-mobile-action-overlay');
    expect(getMobileActionOverlayRootStyle()).toEqual({
      boxSizing: 'border-box',
      left: 16,
      right: 16,
      width: 'auto',
    });
  });
});

describe('getMobileActionOverlayInnerStyle', () => {
  it('fills the pinned root without overflowing it', () => {
    expect(getMobileActionOverlayInnerStyle()).toEqual({
      boxSizing: 'border-box',
      maxWidth: '100%',
      width: '100%',
    });
  });
});
