/** Matches the historical exact-tokenizer cutoff. Each worker call stays under this size. */
export const TOKENIZER_CHUNK_CHARS = 10_000;

/**
 * Split on a late whitespace boundary so a chunk boundary is less likely to
 * cut through a word. A string with no whitespace is split on the hard limit.
 */
export const splitTokenizerChunks = (
  text: string,
  limit = TOKENIZER_CHUNK_CHARS,
): string[] => {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
      if (breakAt >= Math.floor(limit / 2)) end = start + breakAt + 1;
    }
    if (end <= start) end = Math.min(start + limit, text.length);
    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
};
