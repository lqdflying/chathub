export type DallEImageQuality = 'standard' | 'hd';
export type DallEImageStyle = 'vivid' | 'natural';
export type DallEImageSize = '1792x1024' | '1024x1024' | '1024x1792';

export interface DallEImageItem {
  imageId?: string;
  previewUrl?: string;
  prompt: string;
  // Legacy DALL·E-only fields — optional now that the Image tool derives its
  // parameters from the configured image model. Kept so previously-stored
  // messages still type-check.
  quality?: DallEImageQuality;
  size?: DallEImageSize;
  style?: DallEImageStyle;
  /**
   * Which deterministic attempt `taskId` is (0 = first generation; each
   * server-confirmed terminal failure advances it by one). Persisted next to
   * the id so provenance validation can derive the one expected id for this
   * (user, message, index, attempt) tuple — absent counts as attempt 0.
   */
  taskAttempt?: number;
  /**
   * Durable Stop mark. Written after a lane Stop with the post-Stop fence so
   * that persist is not itself cancelled. Reload zeros in-memory fences; this
   * flag is what keeps remount reconciliation from billing an unsubmitted id.
   * Explicit Retry clears it when re-stamping authorization.
   */
  taskCancelled?: boolean;
  /**
   * Lane-scoped Stop fence captured when this `taskId` was prepared (or when
   * an explicit Retry re-authorized it). Mount-time recovery may auto-submit a
   * missing task row only while this still matches the live fence. Leave-topic
   * does not bump the fence; Stop does. Absent on legacy tiles — those missing
   * rows fail closed and wait for Retry.
   */
  taskFence?: number;
  /**
   * The async generation task backing this item. Deterministically derived
   * and persisted BEFORE the create request is sent (write-first), so a
   * reload/navigation at any point can resume or adopt the task instead of
   * orphaning it (and so Retry never re-bills a generation that actually
   * succeeded server-side).
   */
  taskId?: string;
  /**
   * Send-path generation-debug span (`gd_…`) copied from the deferred lane so
   * reload/mount reconciliation can still join `chat_image_task_created` after
   * the volatile lane is gone. Never a prompt, task UUID, or message id.
   */
  spanId?: string;
}
