/**
 * Native Ant Design Form.Item tooltips sit inside a <label htmlFor=…>.
 * Clicking the help icon still activates the associated Switch (label default
 * action). Ant Design only preventDefaults the icon click; mousedown can still
 * activate the control in practice.
 *
 * Capture-phase preventDefault cancels label activation without blocking the
 * tooltip's own React click/hover handlers on the icon.
 *
 * @see https://github.com/ant-design/ant-design/issues/46154
 * @see https://github.com/ant-design/ant-design/issues/52152
 */

const TOOLTIP_SELECTOR = '.ant-form-item-tooltip';

export const isNativeFormItemTooltipEventTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(TOOLTIP_SELECTOR));

const onCapture = (event: Event) => {
  if (!isNativeFormItemTooltipEventTarget(event.target)) return;
  event.preventDefault();
};

const EVENT_TYPES = ['mousedown', 'click'] as const;

export const attachFormItemTooltipGuard = (
  root: Document | Pick<ParentNode, 'addEventListener' | 'removeEventListener'> = document,
): (() => void) => {
  for (const type of EVENT_TYPES) {
    root.addEventListener(type, onCapture, true);
  }

  return () => {
    for (const type of EVENT_TYPES) {
      root.removeEventListener(type, onCapture, true);
    }
  };
};
