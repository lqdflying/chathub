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

// Scan from a `<` to the index just past the tag's closing `>`, honoring quoted
// attribute values so a `>` inside "…"/'…' never ends the tag early.
const tagEnd = (s: string, open: number): number => {
  let quote = '';
  for (let i = open + 1; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  return s.length;
};

// Skip whitespace and HTML comments starting at `from`.
const skipTrivia = (s: string, from: number): number => {
  let i = from;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    return i;
  }
};

// True when s at i starts the `<name` tag (followed by whitespace, `>`, or `/`).
const isStartTag = (s: string, i: number, name: string): boolean => {
  if (s[i] !== '<' || s.slice(i + 1, i + 1 + name.length).toLowerCase() !== name) return false;
  const after = s[i + 1 + name.length];
  return after === undefined || after === '>' || after === '/' || /\s/.test(after);
};

// Insert the storage shim so it runs before any authored script WITHOUT altering
// the parsed document. A naive string search for `<head>` is fooled by tag-like
// text in comments, raw-text (`<script>`/`<style>`/`<title>`/`<textarea>`),
// templates, or quoted attributes; and inserting *before* an authored `<head>`
// makes the parser synthesize its own head first, silently dropping the authored
// head's attributes. So we walk only the well-defined prologue — leading
// whitespace, one doctype, the `<html …>` open tag, comments — with quote-aware
// tag scanning, then insert immediately AFTER the real `<head …>` (preserving its
// attributes) or, when there is no explicit head, at that point (before the first
// head-implying node, so the shim lands in the parser-synthesized head). Nothing
// past the head is scanned, so raw-text/attribute false tags can't capture it.
// Pure string work: deterministic on server and client, no DOMParser.
export const injectSandboxShim = (html: string): string => {
  let i = skipTrivia(html, 0);
  if (html.slice(i, i + 9).toLowerCase() === '<!doctype') i = skipTrivia(html, tagEnd(html, i));
  if (isStartTag(html, i, 'html')) i = skipTrivia(html, tagEnd(html, i));
  if (isStartTag(html, i, 'head')) i = tagEnd(html, i);
  return html.slice(0, i) + SANDBOX_STORAGE_SHIM + html.slice(i);
};
