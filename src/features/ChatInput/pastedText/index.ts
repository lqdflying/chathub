export { createShiftPasteBypassTracker, isShiftModifierPasteShortcut } from './bypass';
export { captureLargePlainPaste } from './capture';
export type { CaptureLargePlainPasteOptions, PasteLikeEvent } from './helpers';
export {
  countPastedTextLines,
  getPastedTextPreview,
  hasClipboardFiles,
  joinPromptWithPastedText,
  PASTED_TEXT_MIN_CHARS,
  PASTED_TEXT_MIN_LINES,
  shouldCollapsePastedText,
} from './helpers';
export { PastedTextScopeProvider, usePastedTextScope } from './PastedTextScopeContext';
export { getThreadPastedTextScope, MAIN_PASTED_TEXT_SCOPE } from './scope';
export { clearPendingPastedTexts, joinInputWithPendingPastedTexts } from './send';
export type { PastedTextItem } from './store';
export {
  getPastedTextStoreState,
  selectPastedTextCount,
  selectPastedTextItems,
  usePastedTextStore,
} from './store';
export {
  useClearPastedTextsOnChatChange,
  useClearPastedTextsOnScopeChange,
} from './useClearOnChatChange';
