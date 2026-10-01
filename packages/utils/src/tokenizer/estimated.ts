import { fallbackTokenCount } from './fallback';

/** Failure-path estimate. Context counts use {@link encodeAsync} first. */
export const estimatedEncodeAsync = async (str: string): Promise<number> =>
  fallbackTokenCount(str);
