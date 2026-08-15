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
// CSS loading spinner (a big ring) stuck forever. This shim (the body of the
// injected <script>) best-effort replaces those objects with inert no-op stubs
// ONLY when accessing them throws, so such scripts survive the sandbox. It grants
// no capability and does NOT relax the sandbox (still no `allow-same-origin`); it
// only no-ops storage in the already opaque origin.
const SANDBOX_STORAGE_SHIM_BODY =
  `(function(){var s={getItem:function(){return null},setItem:function(){},` +
  `removeItem:function(){},clear:function(){},key:function(){return null},length:0};` +
  `['localStorage','sessionStorage'].forEach(function(k){try{void window[k]}catch(e){` +
  `try{Object.defineProperty(window,k,{configurable:true,value:s})}catch(_){}}})})();`;

// Serialize a parsed doctype (outerHTML omits it) so the iframe keeps the
// document's rendering mode — dropping `<!DOCTYPE html>` would force quirks mode.
const serializeDoctype = (dt: DocumentType | null): string => {
  if (!dt) return '';
  const pub = dt.publicId ? ` PUBLIC "${dt.publicId}"` : '';
  const sys = dt.systemId ? `${dt.publicId ? '' : ' SYSTEM'} "${dt.systemId}"` : '';
  return `<!DOCTYPE ${dt.name}${pub}${sys}>`;
};

// Prepend the storage shim to the document's <head> so it runs before any authored
// script, using the real HTML parser rather than string scanning. HTML has many
// comment / bogus-comment tokens (`<!-- -->`, `<!-->`, `<!--->`, `--!>`,
// `<?xml …>`, `<!… >`, `<![CDATA[…]]>`) plus raw-text/attribute contexts; a
// hand-rolled scanner keeps disagreeing with the parser about where the head is,
// which either strands the shim after authored scripts or before an authored
// `<head>` (dropping its attributes). Parsing delegates all of that to the
// browser: the authored `<head>`/`<html>` attributes stay on real elements, and
// the shim is inserted as the first child of the (always-present) parsed `<head>`.
// DOMParser documents are inert — the LLM's own scripts do NOT execute here. This
// is a client-only path (the sandboxed iframe only runs in the browser, like
// `buildStandaloneSVG`); on the server DOMParser is absent and we return the input
// unchanged — nothing executes there, and the client recomputes the shimmed doc.
export const injectSandboxShim = (html: string): string => {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const script = doc.createElement('script');
  script.textContent = SANDBOX_STORAGE_SHIM_BODY;
  doc.head.prepend(script);
  return serializeDoctype(doc.doctype) + doc.documentElement.outerHTML;
};
