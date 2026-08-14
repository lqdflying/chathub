// Detectors for fenced code blocks that hold renderable visual content. Models
// (especially non-Claude ones) often mislabel these — e.g. an SVG in a block
// tagged "plaintext" — so detection is primarily content-based, not language.

export const isHtmlCode = (content: string, language: string): boolean => {
  if ((language || '').toLowerCase() === 'html') return true;
  const c = content.trimStart();
  // only treat FULL documents as renderable HTML; bare fragments stay source
  return /^<!doctype html/i.test(c) || /^<html[\s>]/i.test(c);
};

export const isSvgCode = (content: string, language: string): boolean => {
  if ((language || '').toLowerCase() === 'svg') return true;
  return content.trimStart().startsWith('<svg');
};

export const isVisualCode = (content: string, language: string): boolean =>
  isSvgCode(content, language) || isHtmlCode(content, language);

// True once the block has streamed its closing tag — used to default to source
// while streaming and flip to the rendered view when the document is complete.
export const isVisualComplete = (content: string, language: string): boolean => {
  if (isSvgCode(content, language)) return /<\/svg\s*>/i.test(content);
  return /<\/html\s*>/i.test(content) || /<\/body\s*>/i.test(content);
};
