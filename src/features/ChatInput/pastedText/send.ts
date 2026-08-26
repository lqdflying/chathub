import { joinPromptWithPastedText } from './helpers';
import { usePastedTextStore } from './store';

export const joinInputWithPendingPastedTexts = (prompt: string) => {
  const pastes = usePastedTextStore.getState().items.map((item) => item.content);
  return joinPromptWithPastedText(prompt, pastes);
};

export const clearPendingPastedTexts = () => {
  usePastedTextStore.getState().clearPastedTexts();
};
