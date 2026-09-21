export interface ConversationGenerationApplyResult {
  applied: boolean;
  buffered: boolean;
  owned: boolean;
  /**
   * When `owned` and the frame was not applied, `false` means the drop can
   * never become applicable (clear fence, already-superseded revision). The
   * SSE cursor must still advance. Omit or `true` for a recoverable attach-race.
   */
  recoverable?: boolean;
}

export const shouldPersistConversationGenerationCursor = (
  result: ConversationGenerationApplyResult | void | undefined,
) => {
  if (!result) return true;
  if (result.applied || result.buffered || !result.owned) return true;
  return result.recoverable === false;
};
