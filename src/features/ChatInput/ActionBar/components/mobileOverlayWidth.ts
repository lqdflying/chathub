import type { CSSProperties } from 'react';

/** Apple HIG compact-width layout margin (16pt). */
export const MOBILE_ACTION_OVERLAY_GUTTER_PX = 16;

/**
 * Pin the positioned overlay root to both viewport edges with 16px gutters.
 *
 * Width-only `maxWidth: calc(100vw - 32px)` is not enough. Ant Design Popover
 * and Dropdown keep `placement="top"`, and `@rc-component/trigger` 2.3.1 then
 * `shiftX`s overflow to `visibleRegionArea.left` / `.right`. That docks a
 * narrower popup flush to one screen edge (0px / 32px) instead of 16px / 16px.
 *
 * The trigger writes physical `left` / `right` on the popup. User popup style
 * is merged last (`Popup` spreads `style` after `offsetStyle`), so the same
 * keys must be overridden. Logical-only `inset-inline` would lose to those
 * physical offsets. Symmetric `left`+`right` is also writing-mode stable.
 *
 * Inline `width: 'auto'` is required to beat Ant Design Popover's stylesheet
 * `width: max-content`; otherwise left+right stay over-constrained and the
 * used width stays content-sized.
 *
 * @see https://5x-ant-design.antgroup.com/components/popover
 * @see https://5x-ant-design.antgroup.com/components/dropdown
 * @see https://github.com/react-component/trigger
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
