/**
 * Tokenizer-failure estimate. ASCII is about four characters per token.
 * Other Unicode code points count as one token each, which matches dense CJK
 * tokenizers more closely than a single characters-per-token ratio.
 */
export const fallbackTokenCount = (text: string): number => {
  if (!text) return 0;

  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 128) ascii += 1;
    else nonAscii += 1;
  }

  return Math.ceil(ascii / 4 + nonAscii);
};
