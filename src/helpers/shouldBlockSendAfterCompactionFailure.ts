import type { MemoryCompactionResult } from '@lobechat/types';

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

  const before = result.estimatedTokensBefore;
  const high = result.highWatermark;
  if (
    typeof before === 'number' &&
    before > 0 &&
    typeof high === 'number' &&
    high > 0 &&
    typeof maxTokens === 'number' &&
    maxTokens > 0
  ) {
    return before / maxTokens >= high;
  }

  // Token-threshold compact was attempted and failed without usable estimate
  // fields — still block rather than send into a known ceiling.
  return true;
};
