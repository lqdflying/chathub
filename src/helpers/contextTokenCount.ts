import { countTokensDetailed, fallbackTokenCount, type TokenCountMode } from '@/utils/tokenizer';

const CACHE_LIMIT = 400;

interface CachedTokenCount {
  count: number;
  mode: TokenCountMode;
}

const cache = new Map<string, CachedTokenCount>();

const cacheKey = (text: string): string => {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `${text.length}:${hash >>> 0}`;
};

const remember = (key: string, value: CachedTokenCount) => {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

/** Cached gpt-tokenizer count. Repeated messages and an unchanged draft are not recounted. */
export const countContextTextTokens = async (
  text: string,
): Promise<{ count: number; mode: TokenCountMode }> => {
  if (!text) return { count: 0, mode: 'exact' };

  const key = cacheKey(text);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const counted = await countTokensDetailed(text);
  // A fallback count must not stick as "exact" after the tokenizer recovers.
  if (counted.mode === 'exact') remember(key, counted);
  return counted;
};

export const readCachedContextTokens = (text: string): number | undefined => {
  if (!text) return 0;
  return cache.get(cacheKey(text))?.count;
};

export type TextTokenCounter = (text: string) => number;

/** Sync counter for window math after {@link warmContextTokenCache}. Cold text uses the fallback. */
export const contextTokenCounter = (text: string): number =>
  readCachedContextTokens(text) ?? fallbackTokenCount(text);

export const warmContextTokenCache = async (
  texts: string[],
): Promise<{ mode: TokenCountMode }> => {
  const unique = [...new Set(texts.filter((text) => text.length > 0))];
  const counted = await Promise.all(unique.map((text) => countContextTextTokens(text)));
  return {
    mode: counted.some((item) => item.mode === 'fallback') ? 'fallback' : 'exact',
  };
};

/** Test support. The cache is process-local and would leak fixtures across cases. */
export const clearContextTokenCache = () => {
  cache.clear();
};
