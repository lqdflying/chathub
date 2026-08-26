import type { CSSProperties } from 'react';

/** Apple HIG compact-width layout margin (16pt). */
export const MOBILE_ACTION_OVERLAY_GUTTER_PX = 16;

/**
 * Cap chat-input action overlays so they stay inside the viewport with
 * 16px gutters. Uses `100vw` (not `100dvw`) so iOS chrome show/hide does
 * not resize the overlay while the user scrolls.
 */
export const getMobileActionOverlayMaxWidth = () =>
  `calc(100vw - ${MOBILE_ACTION_OVERLAY_GUTTER_PX * 2}px)`;

export const getMobileActionOverlayBoxStyle = (): CSSProperties => {
  const maxWidth = getMobileActionOverlayMaxWidth();

  return {
    boxSizing: 'border-box',
    maxWidth,
    width: maxWidth,
  };
};
