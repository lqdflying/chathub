import { splitTokenizerChunks } from './chunks';

/**
 * Server-side count using the same `gpt-tokenizer` entry as the browser worker.
 * Chunked so a long tool result does not encode as one blocking call.
 */
export const nodeEncodeChunked = async (text: string): Promise<number> => {
  const { encode } = await import('gpt-tokenizer');
  let total = 0;
  for (const chunk of splitTokenizerChunks(text)) {
    total += encode(chunk).length;
  }
  return total;
};
