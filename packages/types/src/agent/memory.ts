/**
 * Per-topic watermark recorded at rollup time so unchanged topics are never
 * re-fed to the summarizer.
 */
export interface AssistantMemoryTopicWatermark {
  /** Hash of the normalized topic `historySummary` when it was last rolled up. */
  summaryHash: string;
  topicId: string;
  /** `topics.updatedAt` (epoch ms) when it was last rolled up; for debugging/pruning. */
  updatedAt: number;
}

export interface AssistantMemoryLastError {
  /** ISO timestamp of the failed attempt. */
  at: string;
  /** Consecutive failure count; drives the scheduler backoff. */
  attempts: number;
  message: string;
}

/**
 * Rollup bookkeeping stored alongside `assistantMemory` (dynamic memory).
 *
 * Write contract — this object is persisted through config deep-merge
 * (`packages/utils/src/merge.ts` via `SessionModel.updateConfig` and the
 * optimistic `internal_dispatchAgentMap`), where objects merge per key,
 * arrays are replaced wholesale, `undefined` values are skipped and `null`
 * overwrites:
 * - partial patches only touch the keys they carry (e.g. a failure writes
 *   `{ lastError }` alone);
 * - write `null` to clear a key — writing `undefined` is a no-op;
 * - a successful rollup writes the whole object so `topicWatermarks` is
 *   replaced atomically, pruning watermarks of deleted topics.
 */
export interface AssistantMemoryMeta {
  /**
   * UTC period stamp of the last completed dream (`YYYY-MM-DD` or `YYYY-Www`).
   * Written on success and genuine no-op skips; left unchanged on failure/backoff.
   */
  lastDreamMarker?: string | null;
  lastError?: AssistantMemoryLastError | null;
  /** ISO timestamp of the last rollup that advanced the watermarks. */
  lastRollupAt?: string;
  /** One-slot undo backup; restore swaps it with the current memory, so restoring twice is a redo. */
  previousMemory?: { at: string; text: string } | null;
  topicWatermarks?: AssistantMemoryTopicWatermark[];
}
