import type { CSSProperties } from 'react';

/** Apple HIG compact-width layout margin (16pt). */
export const MOBILE_ACTION_OVERLAY_GUTTER_PX = 16;

/** Stable class on the positioned Ant Design popup root (popover/dropdown). */
export const MOBILE_ACTION_OVERLAY_ROOT_CLASS = 'chathub-mobile-action-overlay';

/**
 * Compact card cap for callers such as the context-usage popover.
 * Search overlays already use 320px; keep the token panel in that band.
 */
export const MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX = 320;

export const getMobileActionOverlayMaxWidth = () =>
  `calc(100vw - ${MOBILE_ACTION_OVERLAY_GUTTER_PX * 2}px)`;

/**
 * Size the overlay to its content and keep 16px viewport gutters.
 *
 * Do not set both `left` and `right` with `width: auto`. MDN: an abspos box
 * with both insets and `width: auto` stretch-fills the containing block, which
 * is why the token panel stayed nearly full-bleed on every mobile browser.
 *
 * Ant Design's popup default is `width: max-content` (Dropdown FAQ: use
 * `max-content` so the overlay is not squeezed). Cap with
 * {@link getMobileActionOverlayMaxWidth} and center with `left: 50%` +
 * `translateX(-50%)` so leftover space becomes equal gutters.
 *
 * `@rc-component/trigger` still writes inline `left` after React commit, so
 * the matching stylesheet `!important` class on
 * {@link MOBILE_ACTION_OVERLAY_ROOT_CLASS} is required. Positional properties
 * are non-overridable; `zIndex` still merges.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/position
 * @see https://ant.design/components/dropdown
 * @see https://github.com/ant-design/ant-design/issues/11942
 * @see https://developer.apple.com/design/human-interface-guidelines/layout
 */
export const getMobileActionOverlayRootStyle = (): CSSProperties => ({
  boxSizing: 'border-box',
  left: '50%',
  maxWidth: getMobileActionOverlayMaxWidth(),
  right: 'auto',
  transform: 'translateX(-50%)',
  width: 'max-content',
});

/**
 * Let the inner card fill the content-sized root without forcing 100vw.
 */
export const getMobileActionOverlayInnerStyle = (): CSSProperties => ({
  boxSizing: 'border-box',
  maxWidth: '100%',
  width: 'auto',
});
