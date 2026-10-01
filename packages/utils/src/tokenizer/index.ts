import { splitTokenizerChunks } from './chunks';
import { fallbackTokenCount } from './fallback';

export const MAX_EXACT_TOKENIZER_INPUT_LENGTH = 10_000;

export type TokenCountMode = 'exact' | 'fallback';

export interface TokenCountResult {
  count: number;
  mode: TokenCountMode;
}

/**
 * Count with `gpt-tokenizer` for every length. Long text is split into chunks
 * under {@link MAX_EXACT_TOKENIZER_INPUT_LENGTH} so the browser worker never
 * receives a whole transcript. If tokenization fails, use the ASCII / non-ASCII
 * fallback — never raw string length.
 */
export const countTokensDetailed = async (str: string): Promise<TokenCountResult> => {
  if (!str) return { count: 0, mode: 'exact' };

  try {
    if (typeof Worker === 'undefined') {
      const { nodeEncodeChunked } = await import('./nodeEncode');
      return { count: await nodeEncodeChunked(str), mode: 'exact' };
    }

    const { clientEncodeAsync } = await import('./client');
    let total = 0;
    for (const chunk of splitTokenizerChunks(str)) {
      total += await clientEncodeAsync(chunk);
    }
    return { count: total, mode: 'exact' };
  } catch {
    return { count: fallbackTokenCount(str), mode: 'fallback' };
  }
};

export const encodeAsync = async (str: string): Promise<number> =>
  (await countTokensDetailed(str)).count;

export { fallbackTokenCount } from './fallback';
export { splitTokenizerChunks, TOKENIZER_CHUNK_CHARS } from './chunks';
