import type { CSSProperties } from 'react';

/** Apple HIG compact-width layout margin (16pt). */
export const MOBILE_ACTION_OVERLAY_GUTTER_PX = 16;

/** Stable class on the positioned Ant Design popup root (popover/dropdown). */
export const MOBILE_ACTION_OVERLAY_ROOT_CLASS = 'chathub-mobile-action-overlay';

/**
 * Preferred width for the context-usage popover (matches Search's 320px).
 * Desktop: ActionPopover body min=max=320. Mobile: pass `fixedWidth` so the
 * root uses `min(320px, 100vw - 32px)` instead of content-sized max-content
 * (Ant Design Popover sizes to content by default):
 * https://ant.design/components/popover
 */
export const MOBILE_ACTION_OVERLAY_COMPACT_MAX_PX = 320;

/**
 * Read by the important root `max-width` rule so caller `maxWidth` can win.
 * Unset → `100vw`, which then loses to the viewport-gutter calc.
 */
export const MOBILE_ACTION_OVERLAY_MAX_VAR = '--chathub-mobile-overlay-max';

const toCssLength = (value: number | string) =>
  typeof value === 'number' ? `${value}px` : value;

/** Winning root cap: caller max, else viewport minus 16px gutters. */
export const getMobileActionOverlayMaxWidth = () =>
  `min(var(${MOBILE_ACTION_OVERLAY_MAX_VAR}, 100vw), calc(100vw - ${MOBILE_ACTION_OVERLAY_GUTTER_PX * 2}px))`;

/**
 * Only the CSS variable belongs on the React style object. Position, width,
 * and translate live in the stylesheet `!important` / `translate` rules —
 * inline copies lost to `@rc-component/trigger` `useAlign` (antd#11942).
 *
 * Do not set both `left` and `right` with `width: auto` (MDN abspos stretch).
 * Do not set `transform`; Ant zoom/slide animates that property. Use CSS
 * `translate` instead (independent since 2022).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/position
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/translate
 * @see https://github.com/ant-design/ant-design/issues/11942
 */
export const getMobileActionOverlayRootStyle = (
  maxWidth?: number | string,
): CSSProperties | undefined => {
  if (maxWidth === undefined) return undefined;

  return {
    [MOBILE_ACTION_OVERLAY_MAX_VAR]: toCssLength(maxWidth),
  };
};
