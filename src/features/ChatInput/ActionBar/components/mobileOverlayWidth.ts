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

/**
 * Custom property read by the important root `max-width` rule so a caller
 * `maxWidth` can win the cascade. Defaults to `100vw` when unset.
 */
export const MOBILE_ACTION_OVERLAY_MAX_VAR = '--chathub-mobile-overlay-max';

export const toMobileOverlayCssLength = (value: number | string) =>
  typeof value === 'number' ? `${value}px` : value;

export const getMobileActionOverlayViewportMaxWidth = () =>
  `calc(100vw - ${MOBILE_ACTION_OVERLAY_GUTTER_PX * 2}px)`;

/** Winning root cap: caller max, else viewport minus 16px gutters. */
export const getMobileActionOverlayMaxWidth = () =>
  `min(var(${MOBILE_ACTION_OVERLAY_MAX_VAR}, 100vw), ${getMobileActionOverlayViewportMaxWidth()})`;

/**
 * Size the overlay to its content and keep 16px viewport gutters.
 *
 * Do not set both `left` and `right` with `width: auto`. MDN: an abspos box
 * with both insets and `width: auto` stretch-fills the containing block.
 *
 * Ant Design's popup default is `width: max-content`. Cap with
 * {@link getMobileActionOverlayMaxWidth}. Caller `maxWidth` is stored on
 * {@link MOBILE_ACTION_OVERLAY_MAX_VAR} so the important root rule can see it;
 * a non-important inner `max-width: 100%` must not override that cap.
 *
 * Center with the independent CSS `translate` property, not `transform`.
 * Ant Popover `antZoomBigIn` / Dropdown `antSlideDownIn` animate `transform`
 * (`scale` / `scaleY`); an important `transform: translateX(-50%)` would
 * freeze those motions at scale 1.
 *
 * `@rc-component/trigger` still writes inline `left` after React commit, so
 * positional `left` / `width` / `max-width` stay `!important` on the root
 * class. `translate` is not written by rc-trigger and must stay free of
 * `!important` so it can compose with Ant motion.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/position
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/translate
 * @see https://ant.design/components/dropdown
 * @see https://github.com/ant-design/ant-design/issues/11942
 * @see https://developer.apple.com/design/human-interface-guidelines/layout
 */
export const getMobileActionOverlayRootStyle = (
  maxWidth?: number | string,
): CSSProperties => {
  const style: CSSProperties = {
    boxSizing: 'border-box',
    left: '50%',
    maxWidth: getMobileActionOverlayMaxWidth(),
    right: 'auto',
    translate: '-50% 0',
    width: 'max-content',
  };

  if (maxWidth === undefined) return style;

  return {
    ...style,
    [MOBILE_ACTION_OVERLAY_MAX_VAR]: toMobileOverlayCssLength(maxWidth),
  };
};

/**
 * Inner card follows the root. Do not mark max-width important: caller
 * `maxWidth` and the root CSS variable must be able to win.
 */
export const getMobileActionOverlayInnerStyle = (): CSSProperties => ({
  boxSizing: 'border-box',
  maxWidth: '100%',
  width: 'auto',
});
