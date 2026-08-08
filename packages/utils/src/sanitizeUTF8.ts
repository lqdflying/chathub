/** Remove replacement characters, unsupported controls, and lone UTF-16 surrogates. */
export const sanitizeUTF8 = (value: string): string =>
  value
    .toWellFormed()
    .replaceAll('\uFFFD', '')
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Recursively sanitize strings in arrays and plain records before JSON persistence. */
export const sanitizeUTF8Deep = <Value>(value: Value): Value => {
  if (typeof value === 'string') return sanitizeUTF8(value) as Value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUTF8Deep(item)) as Value;
  }

  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      sanitizeUTF8(key),
      sanitizeUTF8Deep(nestedValue),
    ]),
  ) as Value;
};
