import type { CSSProperties } from 'react';

/** Apple HIG compact-width layout margin (16pt). */
export const MOBILE_ACTION_OVERLAY_GUTTER_PX = 16;

/** Stable class on the positioned Ant Design popup root (popover/dropdown). */
export const MOBILE_ACTION_OVERLAY_ROOT_CLASS = 'chathub-mobile-action-overlay';

/**
 * Pin the positioned overlay root to both viewport edges with 16px gutters.
 *
 * Inline `left`/`right` alone is not enough. `@rc-component/trigger` `useAlign`
 * writes `popupElement.style.left` / `.right` on the DOM after React commit,
 * so Ant Design `styles.root` / `overlayStyle` lose to `shiftX` (flush to one
 * edge, leftover gutter on the other). A stylesheet `!important` class on
 * {@link MOBILE_ACTION_OVERLAY_ROOT_CLASS} beats those inline offsets.
 *
 * `width: 'auto'` beats Ant Design Popover's `width: max-content`; otherwise
 * left+right stay over-constrained and the used width stays content-sized.
 *
 * @see https://github.com/ant-design/ant-design/issues/11942
 * @see https://5x-ant-design.antgroup.com/components/popover
 * @see https://5x-ant-design.antgroup.com/components/dropdown
 * @see https://developer.apple.com/design/human-interface-guidelines/layout
 */
export const getMobileActionOverlayRootStyle = (): CSSProperties => ({
  boxSizing: 'border-box',
  left: MOBILE_ACTION_OVERLAY_GUTTER_PX,
  right: MOBILE_ACTION_OVERLAY_GUTTER_PX,
  width: 'auto',
});

/**
 * Stretch inner popover body / dropdown menu to the pinned root.
 */
export const getMobileActionOverlayInnerStyle = (): CSSProperties => ({
  boxSizing: 'border-box',
  maxWidth: '100%',
  width: '100%',
});
