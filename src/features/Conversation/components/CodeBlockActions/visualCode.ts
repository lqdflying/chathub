// Detectors for fenced code blocks that hold renderable visual content. Models
// (especially non-Claude ones) often mislabel these — e.g. an SVG in a block
// tagged "plaintext" — so detection is primarily content-based, not language.

// A full HTML document (vs a bare fragment). Only full documents have a
// reliable closing marker to detect stream completion.
export const isHtmlDocument = (content: string): boolean => {
  const c = content.trimStart();
  return /^<!doctype html/i.test(c) || /^<html[\s>]/i.test(c);
};

export const isHtmlCode = (content: string, language: string): boolean =>
  (language || '').toLowerCase() === 'html' || isHtmlDocument(content);

export const isSvgCode = (content: string, language: string): boolean => {
  if ((language || '').toLowerCase() === 'svg') return true;
  return content.trimStart().startsWith('<svg');
};

export const isVisualCode = (content: string, language: string): boolean =>
  isSvgCode(content, language) || isHtmlCode(content, language);

// True once the block is renderable — used to default to source while a
// document streams and flip to the rendered view when it is complete. An
// html-language *fragment* has no closing-document marker, so it is treated as
// complete (a received fragment renders by default; a partial full document
// waits for its closing tag).
export const isVisualComplete = (content: string, language: string): boolean => {
  if (isSvgCode(content, language)) return /<\/svg\s*>/i.test(content);
  if (isHtmlDocument(content)) return /<\/html\s*>/i.test(content) || /<\/body\s*>/i.test(content);
  return true;
};
