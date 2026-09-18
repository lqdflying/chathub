/** Extra pixels Virtuoso mounts above/below the visible area. */
export const DESKTOP_OVERSCAN_VIEWPORTS = 1;
export const MOBILE_OVERSCAN_VIEWPORTS = 0.5;
export const MOBILE_OVERSCAN_MAX_PX = 400;

/**
 * Off: `<pre>` is not the same size as Shiki ([Virtuoso scroll handling](https://virtuoso.dev/react-virtuoso/virtuoso/scroll-handling/)).
 * Hold/freeze still jumped the PC list on wheel-stop (`v2.0.7-canary.1` / `.2`).
 */
export const ENABLE_LIGHT_SCROLL_MARKDOWN = false;

/**
 * Virtuoso `isScrolling` also fires on list/layout updates, not only wheel
 * input ([issue #114](https://github.com/petyosi/react-virtuoso/issues/114)).
 */
export const LIGHT_SCROLL_ACTIVATE_MS = 150;

/** Keep minHeight after the wheel stops until Shiki has painted again. */
export const LIGHT_SCROLL_RELEASE_MS = 150;

/** Keep the last idle height; do not sample while light markdown or restore hold is on. */
export const captureSettledRowHeight = (
  lockHeight: boolean,
  elementHeight: number | undefined,
  previousSettled?: number,
): number | undefined => {
  if (!lockHeight && elementHeight !== undefined) return elementHeight;
  return previousSettled;
};

export const shouldApplyLightScrollMarkdown = (
  isLightScroll: boolean,
  settledHeight?: number,
): boolean =>
  ENABLE_LIGHT_SCROLL_MARKDOWN && isLightScroll && settledHeight !== undefined && settledHeight > 0;

/** Virtuoso placeholders must keep size (official scroll-handling example). */
export const resolveFrozenRowMinHeight = (
  lockHeight: boolean,
  settledHeight?: number,
): number | undefined => (lockHeight ? settledHeight : undefined);

export const resolveVisibleViewportHeight = (): number => {
  if (typeof window === 'undefined') return 0;
  return window.visualViewport?.height || window.innerHeight || 0;
};

export const resolveVirtuosoOverscan = (mobile?: boolean): number => {
  const viewport = resolveVisibleViewportHeight();
  if (!viewport) return 0;
  if (!mobile) return viewport * DESKTOP_OVERSCAN_VIEWPORTS;

  return Math.min(viewport * MOBILE_OVERSCAN_VIEWPORTS, MOBILE_OVERSCAN_MAX_PX);
};
