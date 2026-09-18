/** Extra pixels Virtuoso mounts above/below the visible area. */
export const DESKTOP_OVERSCAN_VIEWPORTS = 1;
export const MOBILE_OVERSCAN_VIEWPORTS = 0.5;
export const MOBILE_OVERSCAN_MAX_PX = 400;

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
