export type CodexHelpTrigger = 'click' | 'focus' | 'hover';

/**
 * rc-trigger maps hover show/hide to click on touch. A first tap then
 * focuses (opens) and clicks (toggles closed). Use click-only on coarse
 * / no-hover pointers; keep hover+focus for mouse and keyboard.
 * @see https://ant.design/components/tooltip#how-to-support-keyboard-accessibility
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover
 */
export const COARSE_POINTER_MEDIA = '(hover: none), (pointer: coarse)';

export const CODEX_HELP_TOOLTIP_MAX_WIDTH = 'min(360px, calc(100vw - 32px))';

export const resolveCodexHelpTrigger = (coarsePointer: boolean): CodexHelpTrigger[] =>
  coarsePointer ? ['click'] : ['hover', 'focus'];

export const subscribeCoarsePointer = (onStoreChange: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const media = window.matchMedia(COARSE_POINTER_MEDIA);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
};

export const getCoarsePointerSnapshot = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }

  return window.matchMedia(COARSE_POINTER_MEDIA).matches;
};

export const getCoarsePointerServerSnapshot = () => true;

export const formatCodexPlanLabel = (plan?: string | null) => {
  const trimmed = plan?.trim();
  if (!trimmed) return undefined;

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

export const clampCodexUsagePercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;

  return Math.min(100, Math.max(0, Math.round(value)));
};

export const resolveCodexUsageStroke = (percent: number) => {
  if (percent >= 40) return 'success';
  if (percent >= 15) return 'normal';
  return 'exception';
};
