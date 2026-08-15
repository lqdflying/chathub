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

// The preview iframe runs `sandbox="allow-scripts"` WITHOUT `allow-same-origin`,
// i.e. an opaque origin where accessing `window.localStorage` / `sessionStorage`
// throws `SecurityError`. LLM-authored HTML (e.g. mermaid-in-HTML from a CDN)
// commonly touches storage on init, throws, and never paints — leaving its own
// CSS loading spinner (a big ring) stuck forever. This shim best-effort replaces
// those objects with inert no-op stubs ONLY when accessing them throws, so such
// scripts survive the sandbox. It grants no capability and does NOT relax the
// sandbox (still no `allow-same-origin`); it only no-ops storage in the already
// opaque origin.
const SANDBOX_STORAGE_SHIM =
  `<script>(function(){var s={getItem:function(){return null},setItem:function(){},` +
  `removeItem:function(){},clear:function(){},key:function(){return null},length:0};` +
  `['localStorage','sessionStorage'].forEach(function(k){try{void window[k]}catch(e){` +
  `try{Object.defineProperty(window,k,{configurable:true,value:s})}catch(_){}}})})();</script>`;

// Inject the storage shim at the document's LEADING boundary so it runs before
// any authored node. Anchor ONLY on a leading doctype (matched with `^`), else
// prepend — never a full-string search for a `<head>` and never parsing the
// `<html>` tag. A whole-string search is fooled by tag-looking text that is NOT
// a tag: a `<head>` inside a `<script>`/`<style>`/`<title>`/`<textarea>` body, a
// template, or a quoted attribute — injecting there lands the shim in raw-text
// (its own `</script>` closes the authored script) so it never runs and the
// opaque-origin storage bug persists. And parsing `<html …>` breaks on a `>`
// inside a quoted attribute. A leading doctype cannot contain `>`, so it is a
// safe, O(1) boundary; the shim (a script placed right after the doctype, or
// prepended when there is none) is foster-parented into `<head>` by the HTML
// parser and executes before any authored script. `isHtmlDocument` (the caller's
// gate) guarantees the content starts with a doctype or `<html>`.
export const injectSandboxShim = (html: string): string => {
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + SANDBOX_STORAGE_SHIM + html.slice(at);
};
