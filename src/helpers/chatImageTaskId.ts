import { sha256 } from 'js-sha256';

/**
 * Deterministic write-first chat-image task ids.
 *
 * This is **not** RFC 4122 / RFC 9562 UUIDv5 (SHA-1). It is SHA-256 truncated
 * to 16 bytes with the version-5 nibble and RFC-4122 variant bits set only so
 * the value satisfies UUID-shaped columns. RFC 4122 §6: "Do not assume that
 * UUIDs are hard to guess; they should not be used as security capabilities
 * (identifiers whose mere possession grants access)." Possession of the UUID
 * is therefore not authorization — callers and the server re-derive the
 * expected id from `(userScope, messageId, index, attempt)` and compare.
 *
 * OWASP IDOR prevention: a client-supplied object reference is never
 * sufficient; the server must authorize against the authenticated principal.
 * `userScope` must come from that principal (`user:<rawAuthUserId>` or
 * `local`), never from message content.
 *
 * @see https://www.rfc-editor.org/rfc/rfc4122.html#section-6
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
 */
export const CHAT_IMAGE_TASK_SEED = 'chathub-chat-image-task';

const deriveDeterministicTaskId = (seed: string): string => {
  const bytes = new Uint8Array(sha256.arrayBuffer(seed)).slice(0, 16);
  // decimal to stay neutral in the prettier/unicorn hex-casing conflict:
  // 15/80 = version-5 nibble, 63/128 = RFC-4122 variant
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const deriveChatImageTaskId = (
  userScope: string,
  messageId: string,
  index: number,
  attempt: number,
) =>
  deriveDeterministicTaskId(
    `${CHAT_IMAGE_TASK_SEED}:${userScope}:${messageId}:${index}:${attempt}`,
  );

/**
 * Missing `taskAttempt` counts as 0 (legacy tiles). A non-integer or negative
 * value fails closed — it cannot authorize insert.
 */
export const normalizeChatImageTaskAttempt = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return undefined;
};

export const isChatImageTaskIdProvenanceValid = (
  userScope: string,
  messageId: string,
  index: number,
  taskId: string,
  attempt: number | undefined,
): boolean =>
  Boolean(userScope) &&
  attempt !== undefined &&
  Number.isInteger(attempt) &&
  attempt >= 0 &&
  deriveChatImageTaskId(userScope, messageId, index, attempt) === taskId;

export type ChatImageTaskCorrelationItem = {
  imageId?: string;
  taskAttempt?: unknown;
  taskCancelled?: boolean;
  taskId?: string;
};

export type ChatImageTaskCorrelationDecision =
  'authorized' | 'missing' | 'resolved' | 'stopped' | 'unproven';

export const decideChatImageTaskCorrelation = ({
  index,
  item,
  messageId,
  taskId,
  userScope,
}: {
  index: number;
  item?: ChatImageTaskCorrelationItem;
  messageId: string;
  taskId: string;
  userScope?: string;
}): ChatImageTaskCorrelationDecision => {
  if (!item || item.taskId !== taskId) return 'missing';
  if (
    !userScope ||
    !isChatImageTaskIdProvenanceValid(
      userScope,
      messageId,
      index,
      taskId,
      normalizeChatImageTaskAttempt(item.taskAttempt),
    )
  ) {
    return 'unproven';
  }
  if (item.taskCancelled) return 'stopped';
  if (item.imageId) return 'resolved';
  return 'authorized';
};
