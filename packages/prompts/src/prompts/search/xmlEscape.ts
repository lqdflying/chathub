const XML_ATTR_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};

const XML_CONTENT_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Escape special characters for XML attributes
 * Includes: & " < >
 */
export const escapeXmlAttr = (text: string | undefined | null): string => {
  if (!text) return '';
  return text.replace(/[&"<>]/g, (char) => XML_ATTR_ESCAPE_MAP[char] ?? char);
};

/**
 * Escape special characters for XML content
 * Includes: & < >
 */
export const escapeXmlContent = (text: string | undefined | null): string => {
  if (!text) return '';
  return text.replace(/[&<>]/g, (char) => XML_CONTENT_ESCAPE_MAP[char] ?? char);
};
