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

/**
 * Scope strings this authenticated request may have used when stamping a
 * write-first id. Possession of a UUID is still not authorization (RFC 4122
 * §6): each alias is this caller's namespace, never another principal's.
 *
 * The client `currentUserScope` and the server `resolveAuthenticatedAccountScope`
 * can disagree for the same browser session:
 * - `enableTokenAuth` is `!!process.env.AUTH_TOKEN`. Next.js inlines only
 *   `NEXT_PUBLIC_*` into the browser bundle, so a Docker host with `AUTH_TOKEN`
 *   has `enableAuth=true` on the server and often `enableAuth=false` in the
 *   client, which stamps `local`.
 *   @see https://nextjs.org/docs/app/guides/environment-variables
 * - Unresolved client auth used to fall back to `anonymous`.
 * - Clerk mapping keeps `rawAuthUserId` distinct from the database `userId`.
 */
export const listChatImageTaskIdScopeAliases = (input: {
  authenticatedScope?: string;
  rawAuthUserId?: string | null;
  userId?: string | null;
}): string[] => {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const add = (scope?: string | null) => {
    if (!scope || seen.has(scope)) return;
    seen.add(scope);
    aliases.push(scope);
  };
  add(input.authenticatedScope);
  if (input.rawAuthUserId) add(`user:${input.rawAuthUserId}`);
  if (input.userId) add(`user:${input.userId}`);
  add('local');
  add('anonymous');
  add('guest');
  return aliases;
};

export const matchChatImageTaskIdScope = (
  userScopes: readonly string[],
  messageId: string,
  index: number,
  taskId: string,
  attempt: number | undefined,
): string | undefined =>
  userScopes.find((scope) =>
    isChatImageTaskIdProvenanceValid(scope, messageId, index, taskId, attempt),
  );

export type ChatImageTaskIdScopeKind =
  'anonymous' | 'canonical' | 'guest' | 'local' | 'mapped' | 'none';

export const classifyChatImageTaskIdScopeKind = (
  scope: string | undefined,
  principals: { rawAuthUserId?: string | null; userId?: string | null },
): ChatImageTaskIdScopeKind => {
  if (!scope) return 'none';
  if (scope === 'local') return 'local';
  if (scope === 'anonymous') return 'anonymous';
  if (scope === 'guest') return 'guest';
  if (principals.rawAuthUserId && scope === `user:${principals.rawAuthUserId}`) return 'canonical';
  if (principals.userId && scope === `user:${principals.userId}`) return 'mapped';
  return 'none';
};

export type ChatImageTaskCorrelationItem = {
  imageId?: string;
  spanId?: string;
  taskAttempt?: unknown;
  taskCancelled?: boolean;
  taskFence?: number;
  taskId?: string;
};

export type ChatImageTaskCorrelationDecision =
  'authorized' | 'missing' | 'resolved' | 'stopped' | 'unproven';

export type ChatImageToolMessageLike = {
  content?: string | null;
  id: string;
  plugin?: { apiName?: string; identifier?: string } | null;
  role?: string;
};

export const isChatImageToolMessage = (message: ChatImageToolMessageLike): boolean =>
  message.role === 'tool' &&
  (message.plugin?.identifier === 'lobe-image-designer' ||
    message.plugin?.apiName === 'text2image');

const parseChatImageToolItems = (content: string): ChatImageTaskCorrelationItem[] | undefined => {
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatImageTaskCorrelationItem[]) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Keep durable chat-Image tile ids across a stale message fetch.
 *
 * `useFetchMessages` onSuccess replaces the whole conversation map with
 * `getMessages`. A fetch that started before `imageId`/`taskId` landed (SWR
 * focus revalidate, overlapping `refreshMessages`, a later send) can return
 * the original prompt-only array and wipe the tiles while Artifacts still
 * show the files. Prefer incoming prompts/length; never drop a file id or a
 * Stop mark for the same attempt.
 *
 * @see https://swr.vercel.app/docs/mutation
 */
export const mergeChatImageToolItems = <T extends ChatImageTaskCorrelationItem>(
  incoming: T[],
  existing: T[] | undefined,
): T[] => {
  if (!existing?.length) return incoming;
  return incoming.map((item, index) => {
    const previous = existing[index];
    if (!previous) return item;
    const sameAttempt = !item.taskId || !previous.taskId || item.taskId === previous.taskId;
    return {
      ...item,
      imageId: item.imageId || previous.imageId,
      spanId: item.spanId || previous.spanId,
      taskAttempt: item.taskAttempt ?? previous.taskAttempt,
      taskCancelled: sameAttempt
        ? item.taskCancelled || previous.taskCancelled
        : item.taskCancelled,
      taskFence: item.taskFence ?? previous.taskFence,
      taskId: item.taskId || previous.taskId,
    };
  });
};

export const mergeChatImageToolContent = (
  incomingContent: string,
  existingContent?: string | null,
): string => {
  if (!existingContent) return incomingContent;
  const incoming = parseChatImageToolItems(incomingContent);
  const existing = parseChatImageToolItems(existingContent);
  if (!incoming || !existing) return incomingContent;
  const merged = mergeChatImageToolItems(incoming, existing);
  return JSON.stringify(merged);
};

export const preserveChatImageToolContentOnFetch = <T extends ChatImageToolMessageLike>(
  incoming: T[],
  existing: T[],
): T[] => {
  if (existing.length === 0) return incoming;
  const existingById = new Map(existing.map((message) => [message.id, message]));
  return incoming.map((message) => {
    if (!isChatImageToolMessage(message)) return message;
    const previous = existingById.get(message.id);
    if (!previous?.content) return message;
    const merged = mergeChatImageToolContent(message.content ?? '', previous.content);
    if (merged === (message.content ?? '')) return message;
    return { ...message, content: merged };
  });
};

export const decideChatImageTaskCorrelation = ({
  index,
  item,
  messageId,
  taskId,
  userScopes,
}: {
  index: number;
  item?: ChatImageTaskCorrelationItem;
  messageId: string;
  taskId: string;
  userScopes: readonly string[];
}): ChatImageTaskCorrelationDecision => {
  if (!item || item.taskId !== taskId) return 'missing';
  if (
    !matchChatImageTaskIdScope(
      userScopes,
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
