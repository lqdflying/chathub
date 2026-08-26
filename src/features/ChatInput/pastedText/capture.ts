import { PasteLikeEvent, hasClipboardFiles, shouldCollapsePastedText } from './helpers';
import { usePastedTextStore } from './store';

export const captureLargePlainPaste = (event: PasteLikeEvent): boolean => {
  if (event.shiftKey) return false;
  if (hasClipboardFiles(event.clipboardData)) return false;

  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!shouldCollapsePastedText(text)) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  usePastedTextStore.getState().addPastedText(text);
  return true;
};
