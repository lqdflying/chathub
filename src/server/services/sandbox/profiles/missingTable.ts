/**
 * Postgres `undefined_table` (42P01), including when Drizzle wraps the
 * driver error, or the driver's message naming the table.
 */
export const isMissingTable = (error: unknown, pattern: RegExp) => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { cause?: unknown; code?: unknown; message?: unknown };
    if (record.code === '42P01') return true;
    if (typeof record.message === 'string' && pattern.test(record.message)) return true;
    current = record.cause;
  }
  return false;
};
