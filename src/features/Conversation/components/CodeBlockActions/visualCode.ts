// Detectors for fenced code blocks that hold renderable visual content. Models
// (especially non-Claude ones) often mislabel these — e.g. an SVG in a block
// tagged "plaintext" — so detection is primarily content-based, not language.

// A full HTML document (vs a bare fragment). Only full documents have a
// reliable closing marker to detect stream completion, so only they render
// inline; a bare fragment stays source (it has no completion signal and could
// otherwise run scripts repeatedly while it streams).
export const isHtmlDocument = (content: string): boolean => {
  const c = content.trimStart();
  return /^<!doctype html/i.test(c) || /^<html[\s>]/i.test(c);
};

// Any HTML (full document or fragment) — used for the on-demand eye-icon
// preview, which is fine to offer for a fragment too.
export const isHtmlCode = (content: string, language: string): boolean =>
  (language || '').toLowerCase() === 'html' || isHtmlDocument(content);

export const isSvgCode = (content: string, language: string): boolean => {
  if ((language || '').toLowerCase() === 'svg') return true;
  return content.trimStart().startsWith('<svg');
};

// Renders inline (rendered-by-default): SVG and full HTML documents only. A
// bare html fragment is not inlined — it stays a normal source block.
export const isVisualCode = (content: string, language: string): boolean =>
  isSvgCode(content, language) || isHtmlDocument(content);

// True once the block has streamed its closing tag — used to default to source
// while it streams and flip to the rendered view when complete. Only reached
// for inlined content (SVG or a full HTML document), both of which have a
// closing marker.
export const isVisualComplete = (content: string, language: string): boolean => {
  if (isSvgCode(content, language)) return /<\/svg\s*>/i.test(content);
  return /<\/html\s*>/i.test(content) || /<\/body\s*>/i.test(content);
};
