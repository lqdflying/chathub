import type { MemoryCompactionResult } from '@lobechat/types';

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Token count compared to the high watermark after pre-send compact.
 * `target_unreachable` can still drop usage into the band between low and high —
 * use the post-compaction estimate then. A true `failed` compact may not have
 * persisted a new estimate, so keep `estimatedTokensBefore`.
 */
export const compactionEstimateForSendGate = (
  result: MemoryCompactionResult,
): number | undefined => {
  if (result.status === 'target_unreachable' && isPositiveFinite(result.estimatedTokensAfter)) {
    return result.estimatedTokensAfter;
  }
  if (isPositiveFinite(result.estimatedTokensBefore)) return result.estimatedTokensBefore;
  return undefined;
};

/**
 * After pre-send token-threshold compaction, block chat enqueue when compact
 * failed (or could not reach the low watermark) and usage is still at/above the
 * high watermark. Sending would almost certainly hit an empty ceiling reply.
 */
export const shouldBlockSendAfterCompactionFailure = (
  result: MemoryCompactionResult,
  maxTokens?: number,
): boolean => {
  if (result.status !== 'failed' && result.status !== 'target_unreachable') return false;

  const used = compactionEstimateForSendGate(result);
  const high = result.highWatermark;
  if (
    isPositiveFinite(used) &&
    typeof high === 'number' &&
    high > 0 &&
    typeof maxTokens === 'number' &&
    maxTokens > 0
  ) {
    return used / maxTokens >= high;
  }

  // Token-threshold compact was attempted and failed without usable estimate
  // fields — still block rather than send into a known ceiling.
  return true;
};
