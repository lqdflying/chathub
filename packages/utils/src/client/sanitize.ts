import DOMPurify from 'dompurify';

/**
 * Sanitizes arbitrary HTML content to prevent XSS attacks.
 * Uses DOMPurify's default configuration which strips all dangerous elements and attributes.
 * @param content - The HTML content to sanitize
 * @returns Sanitized HTML content safe for rendering with dangerouslySetInnerHTML
 */
export const sanitizeHTML = (content: string): string => {
  return DOMPurify.sanitize(content);
};

/**
 * Sanitizes SVG content to prevent XSS attacks while preserving safe SVG elements and attributes
 * @param content - The SVG content to sanitize
 * @returns Sanitized SVG content safe for rendering
 */
export const sanitizeSVGContent = (content: string): string => {
  return DOMPurify.sanitize(content, {
    // `role` is not in DOMPurify's SVG attr profile but is required for
    // accessible diagrams (`<svg role="img">` + <title>/<desc>)
    ADD_ATTR: ['role'],
    FORBID_ATTR: [
      'onblur',
      'onchange',
      'onclick',
      'onerror',
      'onfocus',
      'onkeydown',
      'onkeypress',
      'onkeyup',
      'onload',
      'onmousedown',
      'onmouseout',
      'onmouseover',
      'onmouseup',
      'onreset',
      'onselect',
      'onsubmit',
      'onunload',
    ],
    // `style` stays forbidden by design: sanitized SVG is rendered INLINE into
    // the app document (chat bubble + artifacts portal), where a <style> block
    // is not scoped to the SVG — it would apply document-wide CSS (UI spoofing/
    // overlay risk). `script` is XSS; `use`/`foreignObject` are outside the
    // DOMPurify SVG profile and stripped as well. The diagram design system
    // (src/tools/artifacts/systemRole.ts, <svg_diagram_instructions>) needs
    // none of these — themed styling comes from app-side classes instead.
    FORBID_TAGS: ['embed', 'link', 'object', 'script', 'style'],
    KEEP_CONTENT: false,
    USE_PROFILES: { svg: true, svgFilters: true },
  });
};
