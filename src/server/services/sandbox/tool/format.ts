export const READ_DEFAULT_LIMIT = 2000;
export const READ_MAX_LIMIT = 5000;
// Keeps one readFile result within a reasonable share of the context window.
export const READ_MAX_CHARS = 100_000;
const READ_LINE_MAX_CHARS = 2000;

const fatalDecoder = new TextDecoder('utf8', { fatal: true });

/** UTF-8 text, or undefined when the bytes are not text (NUL bytes or invalid UTF-8). */
export const decodeText = (bytes: Uint8Array): string | undefined => {
  if (bytes.subarray(0, 8192).includes(0)) return undefined;
  try {
    return fatalDecoder.decode(bytes);
  } catch {
    return undefined;
  }
};

/** Lines `offset..offset+limit-1` in `cat -n` style, cut at a line boundary when long. */
export const formatNumberedLines = (
  text: string,
  { limit, offset }: { limit?: number; offset?: number },
) => {
  const lines = text.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const totalLines = text === '' ? 0 : lines.length;
  const startLine = Math.max(1, Math.floor(offset ?? 1));
  const maxLines = Math.min(READ_MAX_LIMIT, Math.max(1, Math.floor(limit ?? READ_DEFAULT_LIMIT)));

  const out: string[] = [];
  let size = 0;
  for (let line = startLine; line <= totalLines && out.length < maxLines; line += 1) {
    let value = lines[line - 1];
    if (value.length > READ_LINE_MAX_CHARS) {
      value = `${value.slice(0, READ_LINE_MAX_CHARS)}…[line truncated]`;
    }
    const formatted = `${String(line).padStart(6)}\t${value}`;
    if (out.length > 0 && size + formatted.length + 1 > READ_MAX_CHARS) break;
    out.push(formatted);
    size += formatted.length + 1;
  }

  const endLine = out.length > 0 ? startLine + out.length - 1 : undefined;
  return {
    content: out.join('\n'),
    endLine,
    startLine,
    totalLines,
    truncated: (endLine ?? startLine - 1) < totalLines,
  };
};

/** Seconds from the model to milliseconds within the operator limits. */
export const resolveTimeoutMs = (
  seconds: number | undefined,
  { defaultMs, maxMs }: { defaultMs: number; maxMs: number },
) => {
  // An operator default above the maximum still applies.
  const ceiling = Math.max(defaultMs, maxMs);
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return defaultMs;
  return Math.min(ceiling, Math.max(1000, Math.round(seconds * 1000)));
};
