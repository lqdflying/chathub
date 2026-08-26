export const PASTED_TEXT_MIN_CHARS = 1000;
export const PASTED_TEXT_MIN_LINES = 10;

const PREVIEW_LINES = 6;
const PREVIEW_LINE_CHARS = 72;

export const countPastedTextLines = (text: string) => {
  if (!text) return 0;
  return text.split('\n').length;
};

export const shouldCollapsePastedText = (text: string) => {
  if (!text) return false;
  return text.length >= PASTED_TEXT_MIN_CHARS || countPastedTextLines(text) >= PASTED_TEXT_MIN_LINES;
};

export const getPastedTextPreview = (text: string) => {
  const lines = text.split('\n');
  const clipped = lines.slice(0, PREVIEW_LINES).map((line) =>
    line.length > PREVIEW_LINE_CHARS ? `${line.slice(0, PREVIEW_LINE_CHARS)}…` : line,
  );
  const truncated = lines.length > PREVIEW_LINES;
  const body = clipped.join('\n');

  return truncated ? `${body}…` : body;
};

export const joinPromptWithPastedText = (prompt: string, pastes: string[]) =>
  [prompt.trim(), ...pastes.map((item) => item.replace(/\s+$/u, '')).filter(Boolean)]
    .filter(Boolean)
    .join('\n\n');

export const hasClipboardFiles = (data: DataTransfer | null | undefined) => {
  if (!data) return false;
  if (data.files && data.files.length > 0) return true;
  return Array.from(data.items ?? []).some((item) => item.kind === 'file');
};

export interface PasteLikeEvent {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
  shiftKey: boolean;
  stopImmediatePropagation?: () => void;
  stopPropagation: () => void;
}
