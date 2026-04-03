/**
 * Escape special characters for XML attributes
 * Includes: & " < >
 */
export const escapeXmlAttr = (text: string | undefined | null): string => {
  if (!text) return '';
  return text
    .replaceAll('&', '&amp;') // nosemgrep: detect-replaceall-sanitization -- intentional complete XML attr escaping
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
};

/**
 * Escape special characters for XML content
 * Includes: & < >
 */
export const escapeXmlContent = (text: string | undefined | null): string => {
  if (!text) return '';
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); // nosemgrep: detect-replaceall-sanitization -- intentional complete XML content escaping
};
