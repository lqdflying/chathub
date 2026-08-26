import {
  CaptureLargePlainPasteOptions,
  PasteLikeEvent,
  hasClipboardFiles,
  shouldCollapsePastedText,
} from './helpers';
import { usePastedTextStore } from './store';

export const captureLargePlainPaste = (
  event: PasteLikeEvent,
  { bypass = false, scope }: CaptureLargePlainPasteOptions,
): boolean => {
  if (bypass) return false;
  if (hasClipboardFiles(event.clipboardData)) return false;

  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!shouldCollapsePastedText(text)) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  usePastedTextStore.getState().addPastedText(scope, text);
  return true;
};
