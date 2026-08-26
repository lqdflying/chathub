export const MAIN_PASTED_TEXT_SCOPE = 'main';

export const getThreadPastedTextScope = (threadId: string | null | undefined) =>
  threadId ? `thread:${threadId}` : 'thread';
