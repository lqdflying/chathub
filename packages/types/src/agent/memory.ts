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
 * Provenance of a memory entry (M2).
 * - `owner` — user edit via assistant settings;
 * - `dream` — scheduled dream card;
 * - `agent` — memory-tool write during a chat;
 * - `untrusted` — memory-tool write downgraded because the writing turn's
 *   recent history contained external (MCP / web) tool output, a
 *   prompt-injection persistence vector.
 *
 * Entries without a recorded origin predate provenance and render trusted.
 */
export type MemoryEntryOrigin = 'agent' | 'dream' | 'owner' | 'untrusted';

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
   * Provenance per memory entry, keyed by content hash (`hashText` of the
   * fixed-entry text or dream-card body). Absent key = predates provenance,
   * rendered trusted. See {@link MemoryEntryOrigin}.
   */
  entryOrigins?: Record<string, MemoryEntryOrigin>;
  /**
   * ISO timestamp of the latest scheduled dream attempt that committed an
   * outcome. Dream-specific — the browser manual-rollup action never writes
   * it, so the settings UI can show dream status without misattributing
   * legacy/manual `lastRollupAt` values.
   */
  lastDreamAt?: string;
  /**
   * UTC period stamp of the last completed dream (`YYYY-MM-DD` or `YYYY-Www`).
   * Written on success and genuine no-op skips; left unchanged on failure/backoff.
   */
  lastDreamMarker?: string | null;
  /**
   * Outcome of the latest scheduled dream attempt: `completed` covers success
   * and genuine no-op skips (nothing to roll up); `failed` means the attempt
   * recorded `lastError` and backs off. Always written together with
   * `lastDreamAt`.
   */
  lastDreamStatus?: 'completed' | 'failed';
  lastError?: AssistantMemoryLastError | null;
  /** ISO timestamp of the last rollup that advanced the watermarks. */
  lastRollupAt?: string;
  /** One-slot undo backup; restore swaps it with the current memory, so restoring twice is a redo. */
  previousMemory?: { at: string; text: string } | null;
  topicWatermarks?: AssistantMemoryTopicWatermark[];
}
