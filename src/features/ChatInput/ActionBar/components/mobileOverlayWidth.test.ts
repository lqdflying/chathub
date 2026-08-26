import { describe, expect, it } from 'vitest';

import {
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  getMobileActionOverlayBoxStyle,
  getMobileActionOverlayMaxWidth,
} from './mobileOverlayWidth';

describe('getMobileActionOverlayMaxWidth', () => {
  it('leaves 16px gutters on both sides of 100vw', () => {
    expect(MOBILE_ACTION_OVERLAY_GUTTER_PX).toBe(16);
    expect(getMobileActionOverlayMaxWidth()).toBe('calc(100vw - 32px)');
  });
});

describe('getMobileActionOverlayBoxStyle', () => {
  it('caps width inside the gutter and includes padding in the box', () => {
    const maxWidth = getMobileActionOverlayMaxWidth();

    expect(getMobileActionOverlayBoxStyle()).toEqual({
      boxSizing: 'border-box',
      maxWidth,
      width: maxWidth,
    });
  });
});
