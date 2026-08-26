import { joinPromptWithPastedText } from './helpers';
import { selectPastedTextItems, usePastedTextStore } from './store';

export const joinInputWithPendingPastedTexts = (prompt: string, scope: string) => {
  const pastes = selectPastedTextItems(scope)(usePastedTextStore.getState()).map(
    (item) => item.content,
  );
  return joinPromptWithPastedText(prompt, pastes);
};

export const clearPendingPastedTexts = (scope: string) => {
  usePastedTextStore.getState().clearPastedTexts(scope);
};
