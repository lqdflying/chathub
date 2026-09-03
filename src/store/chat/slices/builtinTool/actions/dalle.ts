import { ChatImageItem, ToolDiagnosticTerminalOutcome, UIChatMessage } from '@lobechat/types';
import { produce } from 'immer';
import { omit } from 'lodash-es';
import { RuntimeImageGenParams } from 'model-bank';
import pMap from 'p-map';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import {
  deriveChatImageTaskId,
  isActiveChatImageSlotStatus,
  isChatImageToolMessage,
  listChatImageTaskIdScopeAliases,
  matchChatImageTaskIdScope,
  singletonLinkedChatImageId,
} from '@/helpers/chatImageTaskId';
import { logDeferredGenerationLane } from '@/libs/logger/generationDebugClient';
import { useClientDataSWR } from '@/libs/swr';
import { findRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { fileService } from '@/services/file';
import { imageGenerationService } from '@/services/textToImage';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import type { ConversationContext } from '@/store/chat/types';
import {
  isConversationClearFenceCurrent,
  resolveConversationClearGeneration,
} from '@/store/chat/utils/conversationClearGeneration';
import {
  findDeferredBrowserGenerationLaneByAssistantId,
  findDeferredBrowserGenerationLaneForConversation,
} from '@/store/chat/utils/deferredBrowserGeneration';
import { findMessageInMessagesMap, messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getImageStoreState } from '@/store/image';
import {
  getModelAndDefaults,
  isImageModelConfigUsable,
} from '@/store/image/slices/generationConfig/modelConfig';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { DallEImageItem } from '@/types/tool/dalle';
import { setNamespace } from '@/utils/storeDebug';

import { serializePluginError } from './helpers';

const n = setNamespace('tool');

const SWR_FETCH_KEY = 'FetchImageItem';

// Resolve the image model/provider the tool should use — the same configuration
// as the main Image workspace — falling back to the first usable enabled model.
const resolveImageModel = ():
  { model: string; params: RuntimeImageGenParams; provider: string } | undefined => {
  const s = getImageStoreState();
  // Only trust the store once the owner-aware image config has hydrated (mounted
  // globally in StoreInitialization). Before that it still holds the hard-coded
  // initial default (openai/gpt-image-2), which must NOT be used to bill a
  // request as if it were the user's saved choice.
  if (!s.isInit) return undefined;

  const provider = imageGenerationConfigSelectors.provider(s);
  const model = imageGenerationConfigSelectors.model(s);

  if (isImageModelConfigUsable(model, provider)) {
    // reuse the menu's params (size/steps/cfg/…) but drop per-generation fields
    // that don't apply to a text-only chat tool (incl. singular/plural reference
    // images, which would otherwise turn generation into an edit)
    const params = omit(imageGenerationConfigSelectors.parameters(s), [
      'imageUrl',
      'imageUrls',
      'prompt',
    ]) as RuntimeImageGenParams;
    return { model, params, provider };
  }

  const list = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());
  for (const providerItem of list) {
    for (const modelItem of providerItem.children) {
      if (isImageModelConfigUsable(modelItem.id, providerItem.id)) {
        return {
          model: modelItem.id,
          params: getModelAndDefaults(modelItem.id, providerItem.id).defaultValues,
          provider: providerItem.id,
        };
      }
    }
  }
};

// Poll cadence/budget for the async generation task (the same task infra the
// Image workspace uses; ASYNC_TASK_TIMEOUT server-side is 298 s).
const TASK_POLL_INTERVAL = 2500;
const TASK_POLL_BUDGET = 300_000;
const TERMINAL_TASK_STATUSES = new Set(['success', 'error']);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Tasks currently being polled in this tab, keyed `${messageId}_${index}` and
// mapped to the OWNING run's token — prevents the render-mount reconciler and
// an active generation loop from double-polling the same item, and lets a
// run's function-level cleanup release only keys it still owns (a leaked key
// would otherwise make reconcile/Retry silently no-op until a full reload).
const inFlightTaskKeys = new Map<string, symbol>();
const claimTaskKey = (key: string, token: symbol): boolean => {
  if (inFlightTaskKeys.has(key)) return false;
  inFlightTaskKeys.set(key, token);
  return true;
};
const releaseTaskKey = (key: string, token: symbol) => {
  if (inFlightTaskKeys.get(key) === token) inFlightTaskKeys.delete(key);
};

// DETERMINISTIC task ids — shared with the server (`chatImageTaskId`). Every
// tab derives the SAME id for the same (user, message, item, attempt), so a
// cross-tab overlap cannot create two different paid tasks. A replacement is
// the NEXT ATTEMPT of the same tuple (R16-3). Provenance is one derivation +
// comparison; restored/imported messages with new ids fail closed.

// Owner-aware image config hydrates asynchronously after reload; "still
// initializing" must never be conflated with "initialized and no usable
// model". Bounded, invalidation-aware wait used by automatic recovery.
const IMAGE_CONFIG_READY_TIMEOUT = 30_000;
const IMAGE_CONFIG_READY_INTERVAL = 500;
const waitForImageConfigReady = async (isCurrent: () => boolean): Promise<boolean> => {
  const deadline = Date.now() + IMAGE_CONFIG_READY_TIMEOUT;
  while (Date.now() < deadline) {
    if (!isCurrent()) return false;
    if (getImageStoreState().isInit) return true;
    await sleep(IMAGE_CONFIG_READY_INTERVAL);
  }
  // FINAL check once the last sleep crosses the deadline: a readiness flip
  // INSIDE that closing interval fired the renderer's isInit effect while
  // this run still owned the item key (so that invocation returned without
  // doing anything) — the owner must consume the flip itself. Between this
  // synchronous check and the key release there is no await, so a flip AFTER
  // it can only be observed by the effect once the key is free (R17-1).
  return isCurrent() && getImageStoreState().isInit;
};

// Per-message write queues for updateImageItem (see that action's comment).
const imageItemUpdateQueues = new Map<string, Promise<unknown>>();

// A poll error is only worth retrying when it is transient. The HTTP status
// decides regardless of shape: a guarded (mangled-transport) response STILL
// carries `details.httpStatus`, and a guarded 400/401/403 is just as permanent
// as a plain tRPC one. Only 5xx and status-less transport failures retry.
const isTransientPollError = (error: unknown) => {
  const guarded = findRPCResponseError(error);
  const status =
    guarded?.details.httpStatus ?? (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
  if (typeof status === 'number') return status >= 500;
  return Boolean(guarded);
};

// Marks errors that represent an AUTHORITATIVE terminal task state returned by
// the server (status `error`, or `result_missing` for a success whose file is
// gone) — as opposed to lookup/transport failures or local timeouts, which say
// nothing about the task itself and must never justify creating a replacement
// (billable) generation. `task_missing` is NOT terminal.
const isTerminalTaskStateError = (error: unknown) =>
  Boolean((error as { taskTerminal?: boolean })?.taskTerminal);

const firstActionableAliasError = (items: { error?: unknown }[]): unknown | undefined => {
  const terminal = items.find((item) => isTerminalTaskStateError(item.error));
  if (terminal?.error) return terminal.error;
  return items.find((item) => item.error)?.error;
};

// Wait for the async generation task to settle. The generation itself (which
// can take 30–60 s) runs server-side — the browser only ever polls small
// status payloads, never holds a long request open, and never receives image
// bytes (the server uploads them and returns a durable file id).
const waitForChatImageTask = async (
  taskId: string,
  isCurrent: () => boolean,
  options?: { adoptProbe?: boolean; immediate?: boolean },
): Promise<{
  file?: { height?: number; id: string; width?: number };
  notFound?: boolean;
  ok: boolean;
}> => {
  const deadline = Date.now() + TASK_POLL_BUDGET;
  let firstCheck = options?.immediate === true;
  while (Date.now() < deadline) {
    if (!firstCheck) await sleep(TASK_POLL_INTERVAL);
    firstCheck = false;
    if (!isCurrent()) return { ok: false };

    let result;
    try {
      result = await imageGenerationService.getChatImageResult(taskId);
    } catch (error) {
      if (isTransientPollError(error)) continue;
      throw error;
    }

    const status = (result.status ?? '').toLowerCase();
    if (status === 'success' && result.file) return { file: result.file, ok: true };
    // A persisted id whose TASK ROW does not exist is not terminal: with
    // deterministic ids another tab's create may be racing, and a dangling id
    // is recovered by re-submitting the SAME id (idempotent). An adopt probe
    // reports it so the caller can do exactly that; the post-create polling
    // wait treats it as transient insert visibility. ('not_found' is the
    // legacy conflated status, kept for compatibility.)
    if (status === 'task_missing' || status === 'not_found') {
      if (options?.adoptProbe) return { notFound: true, ok: true };
      continue;
    }
    // The task SUCCEEDED but its result file is gone — an authoritative
    // failure of this attempt: only the deterministic replacement id can
    // advance it (re-submitting the success id can never be re-claimed).
    if (status === 'result_missing') {
      throw Object.assign(
        new Error('The generated image result is no longer available for this task.'),
        { name: 'ImageResultMissing', taskTerminal: true },
      );
    }
    if (TERMINAL_TASK_STATUSES.has(status)) {
      const error = result.error;
      throw Object.assign(
        new Error(error?.body?.detail || error?.name || `Image generation ${status}`),
        // taskTerminal marks this as an authoritative server-side terminal
        // state — the only condition that may ever justify a replacement task
        { name: error?.name ?? 'ImageGenerationError', taskTerminal: true },
      );
    }
  }
  throw new Error('Image generation timed out while waiting for the task result.');
};

type ChatImageAliasRecovery =
  | { error: unknown; file?: undefined; ok: false; taskId?: string }
  | {
      error?: undefined;
      file: { height?: number; id: string; width?: number };
      ok: true;
      taskId: string;
    }
  | { error?: undefined; file?: undefined; ok: false; taskId?: string };

const recoverChatImageSlotAliases = async ({
  attempt,
  index,
  invocationIsCurrent,
  messageId,
  preferredTaskId,
}: {
  attempt?: number;
  index: number;
  invocationIsCurrent: () => boolean;
  messageId: string;
  preferredTaskId: string;
}): Promise<ChatImageAliasRecovery> => {
  const userState = useUserStore.getState();
  const taskIds = new Set<string>([preferredTaskId]);
  if (attempt !== undefined) {
    for (const scope of listChatImageTaskIdScopeAliases({
      authenticatedScope: authSelectors.currentUserScope(userState),
      rawAuthUserId: userState.authUserId,
      userId: userState.user?.id,
    })) {
      taskIds.add(deriveChatImageTaskId(scope, messageId, index, attempt));
    }
  }

  const snapshots = await Promise.all(
    [...taskIds].map(async (taskId) => {
      try {
        const result = await imageGenerationService.getChatImageResult(taskId);
        return { result, taskId };
      } catch (error) {
        return { error, taskId };
      }
    }),
  );
  if (!invocationIsCurrent()) return { ok: false };

  const successful = snapshots.find(
    (snapshot) =>
      (snapshot.result?.status ?? '').toLowerCase() === 'success' && snapshot.result?.file,
  );
  if (successful?.result?.file) {
    return { file: successful.result.file, ok: true, taskId: successful.taskId };
  }

  const activeIds = snapshots
    .filter((snapshot) => isActiveChatImageSlotStatus(snapshot.result?.status ?? ''))
    .map((snapshot) => snapshot.taskId);
  if (activeIds.length > 0) {
    let winner:
      { file: { height?: number; id: string; width?: number }; taskId: string } | undefined;
    const stillOpen = () => invocationIsCurrent() && !winner;
    const settled = await Promise.all(
      activeIds.map(async (taskId) => {
        try {
          const recovered = await waitForChatImageTask(taskId, stillOpen, { immediate: true });
          if (recovered.ok && recovered.file && !winner) {
            winner = { file: recovered.file, taskId };
          }
          return { recovered, taskId };
        } catch (error) {
          return { error, taskId };
        }
      }),
    );
    if (winner) return { file: winner.file, ok: true, taskId: winner.taskId };
    if (!invocationIsCurrent()) return { ok: false };
    const pollError = firstActionableAliasError(settled);
    if (pollError) return { error: pollError, ok: false };
    return { ok: false };
  }

  const terminalSnapshot = snapshots.find(
    (snapshot) =>
      isTerminalTaskStateError(snapshot.error) ||
      ['error', 'result_missing'].includes((snapshot.result?.status ?? '').toLowerCase()),
  );
  if (terminalSnapshot?.error) return { error: terminalSnapshot.error, ok: false };
  if (terminalSnapshot?.result) {
    const error = terminalSnapshot.result.error;
    const status = terminalSnapshot.result.status;
    return {
      error: Object.assign(
        new Error(error?.body?.detail || error?.name || `Image generation ${status}`),
        {
          name:
            status === 'result_missing'
              ? 'ImageResultMissing'
              : (error?.name ?? 'ImageGenerationError'),
          taskTerminal: true,
        },
      ),
      ok: false,
    };
  }
  const lookupError = firstActionableAliasError(snapshots);
  if (lookupError) return { error: lookupError, ok: false };
  return { ok: false };
};

type ChatImageRunOutcome =
  | 'already_done'
  | 'failed'
  | 'no_model'
  | 'no_origin'
  | 'not_current'
  | 'ok'
  | 'partial'
  | 'persist_unproven';

const toText2ImageInvocation = (
  runOutcome: ChatImageRunOutcome,
  data: DallEImageItem[],
): {
  data: unknown;
  outcome: ToolDiagnosticTerminalOutcome;
  shouldContinue: boolean;
} => {
  switch (runOutcome) {
    case 'ok':
    case 'already_done':
    case 'partial':
      return { data, outcome: 'completed', shouldContinue: true };
    case 'persist_unproven':
      return { data, outcome: 'persistence_failed', shouldContinue: false };
    case 'not_current':
      return { data: undefined, outcome: 'cancelled', shouldContinue: false };
    default:
      return { data, outcome: 'failed', shouldContinue: false };
  }
};

const resolveOriginatingImageToolMessage = (
  state: ChatStore,
  messageId: string,
):
  | { conversationContext: ConversationContext; mapKey: string; message: UIChatMessage }
  | undefined => {
  const hit = findMessageInMessagesMap(state.messagesMap, messageId);
  if (!hit?.sessionId) return;

  const threadId = hit.message.threadId ?? null;

  return {
    conversationContext: {
      clearGeneration: resolveConversationClearGeneration(
        state,
        hit.sessionId,
        hit.topicId,
        threadId,
      ),
      generation: state.conversationNavigationGeneration,
      sessionId: hit.sessionId,
      threadId,
      topicId: hit.topicId,
    },
    mapKey: hit.mapKey,
    message: hit.message,
  };
};

const isImageToolFenceCurrent = (state: ChatStore, conversationContext: ConversationContext) =>
  isConversationClearFenceCurrent(
    state,
    conversationContext.clearGeneration,
    conversationContext.sessionId,
    conversationContext.topicId,
    conversationContext.threadId,
  );

const GENERATION_DEBUG_SPAN_ID_PATTERN = /^gd_[\da-f]{16,64}$/i;

const resolvePersistedChatImageSpanId = (value?: string) =>
  typeof value === 'string' && GENERATION_DEBUG_SPAN_ID_PATTERN.test(value) ? value : undefined;

const CHAT_IMAGE_TASK_CANCELLED_ERROR = 'ChatImageTaskCancelled';
const CHAT_IMAGE_STOPPED_REGISTRY_KEY = 'chathub:chat-image:stopped-v1';
const CHAT_IMAGE_STOPPED_REGISTRY_LIMIT = 256;
const CHAT_IMAGE_STOPPED_TASK_PREFIX = 'chathub:chat-image:stopped:';

const stoppedChatImageTaskStorageKey = (taskId: string) =>
  `${CHAT_IMAGE_STOPPED_TASK_PREFIX}${taskId}`;

const readStoppedChatImageTaskIds = (): string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(CHAT_IMAGE_STOPPED_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { ids?: unknown };
    return Array.isArray(parsed?.ids)
      ? parsed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
};

const writeStoppedChatImageTaskIds = (ids: string[]) => {
  const next = [...new Set(ids)].slice(0, CHAT_IMAGE_STOPPED_REGISTRY_LIMIT);
  globalThis.localStorage?.setItem(CHAT_IMAGE_STOPPED_REGISTRY_KEY, JSON.stringify({ ids: next }));
};

const rememberStoppedChatImageTask = (taskId: string) => {
  try {
    writeStoppedChatImageTaskIds([
      taskId,
      ...readStoppedChatImageTaskIds().filter((id) => id !== taskId),
    ]);
  } catch {
    // quota / privacy mode — message persist and the server tombstone remain
  }
};

const forgetStoppedChatImageTask = (taskId?: string) => {
  if (!taskId) return;
  try {
    writeStoppedChatImageTaskIds(readStoppedChatImageTaskIds().filter((id) => id !== taskId));
    globalThis.localStorage?.removeItem(stoppedChatImageTaskStorageKey(taskId));
  } catch {
    // ignore
  }
};

const isStoppedChatImageTaskRemembered = (taskId?: string) => {
  if (!taskId) return false;
  try {
    if (readStoppedChatImageTaskIds().includes(taskId)) return true;
    return globalThis.localStorage?.getItem(stoppedChatImageTaskStorageKey(taskId)) === '1';
  } catch {
    return false;
  }
};

const isChatImageStopTombstoneError = (error: unknown) =>
  (error as { name?: string } | undefined)?.name === CHAT_IMAGE_TASK_CANCELLED_ERROR;

const stampChatImageTaskAuthorization = (
  target: DallEImageItem,
  clearGeneration: number,
  spanId?: string,
) => {
  target.taskFence = clearGeneration;
  delete target.taskCancelled;
  forgetStoppedChatImageTask(target.taskId);
  const nextSpan =
    resolvePersistedChatImageSpanId(spanId) ?? resolvePersistedChatImageSpanId(target.spanId);
  if (nextSpan) target.spanId = nextSpan;
};

const isChatImageAutoCreateAuthorized = (
  item: DallEImageItem,
  state: ChatStore,
  conversationContext: ConversationContext,
) => {
  if (item.taskCancelled || isStoppedChatImageTaskRemembered(item.taskId)) return false;
  if (typeof item.taskFence !== 'number') return false;
  const live = resolveConversationClearGeneration(
    state,
    conversationContext.sessionId,
    conversationContext.topicId,
    conversationContext.threadId,
  );
  // Same-session Stop bumps the live fence; a stale prepared fence must not
  // auto-submit. Reload resets live to 0, so this mismatch is skipped then —
  // `taskCancelled`, the remembered stop id, and a server cancelled-placeholder
  // row cover Stop across reload / another device. Comparing a persisted fence
  // against that reset zero would reject a later authorized generation
  // (taskFence > 0) as if it had been stopped.
  if (live !== 0 && live !== item.taskFence) return false;
  return true;
};

type PreparedChatImageStop = {
  items: DallEImageItem[];
  message: UIChatMessage;
  taskIds: string[];
};

type ChatImageStopTombstoneItem = {
  index: number;
  messageId: string;
  taskId: string;
};

const collectPreparedChatImageStops = (
  state: ChatStore,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
): PreparedChatImageStop[] => {
  const messages = state.messagesMap[messageMapKey(sessionId, topicId)] ?? [];
  const prepared: PreparedChatImageStop[] = [];
  const userState = useUserStore.getState();
  const userScopes = listChatImageTaskIdScopeAliases({
    authenticatedScope: authSelectors.currentUserScope(userState),
    rawAuthUserId: userState.authUserId,
    userId: userState.user?.id,
  });

  for (const message of messages) {
    if ((message.threadId ?? null) !== (threadId ?? null)) continue;
    if (!isChatImageToolMessage(message, userScopes)) continue;

    let items: DallEImageItem[];
    try {
      items = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;

    const taskIds = items
      .filter((item) => item?.taskId && !item.imageId)
      .map((item) => item.taskId as string);
    if (taskIds.length === 0) continue;

    prepared.push({ items, message, taskIds });
  }

  return prepared;
};

const collectUnpaidChatImageStopTombstones = (
  state: ChatStore,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
): ChatImageStopTombstoneItem[] => {
  const prepared = collectPreparedChatImageStops(state, sessionId, topicId, threadId);
  // Skip tiles that already persist `taskCancelled` so a long topic cannot
  // blow the 64-item server batch and drop a newly unpaid id.
  const items: ChatImageStopTombstoneItem[] = [];
  const seen = new Set<string>();
  for (const entry of prepared) {
    for (const [index, item] of entry.items.entries()) {
      if (!item?.taskId || item.imageId || item.taskCancelled || seen.has(item.taskId)) continue;
      seen.add(item.taskId);
      items.push({ index, messageId: entry.message.id, taskId: item.taskId });
    }
  }
  return items;
};

const snapshotAndRememberPreparedChatImageStops = (
  state: ChatStore,
  sessionId: string,
  topicId?: string | null,
  threadId?: string | null,
): PreparedChatImageStop[] => {
  const prepared = collectPreparedChatImageStops(state, sessionId, topicId, threadId);
  for (const { taskIds } of prepared) {
    for (const taskId of taskIds) rememberStoppedChatImageTask(taskId);
  }
  return prepared;
};

const resolveChatImageDebugLane = (
  state: ChatStore,
  assistantMessageId: string,
  sessionId?: string | null,
  topicId?: string | null,
) =>
  findDeferredBrowserGenerationLaneByAssistantId(
    state.deferredBrowserGenerationLanes,
    assistantMessageId,
  ) ??
  findDeferredBrowserGenerationLaneForConversation(
    state.deferredBrowserGenerationLanes,
    sessionId,
    topicId,
  );

const logChatImageGeneration = (
  state: ChatStore,
  event: 'chat_image_item_settled' | 'chat_image_run_settled' | 'chat_image_run_started',
  input: {
    assistantMessageId: string;
    sessionId?: string | null;
    threadId?: string | null;
    topicId?: string | null;
  } & Record<string, unknown>,
) => {
  const { assistantMessageId, sessionId, threadId, topicId, ...fields } = input;
  const match = resolveChatImageDebugLane(state, assistantMessageId, sessionId, topicId);
  const originKey = sessionId ? messageMapKey(sessionId, topicId) : undefined;
  void logDeferredGenerationLane(event, {
    assistantMessageId,
    sessionId,
    spanId: match?.lane.spanId,
    threadId,
    topicId,
    toolName: 'lobe-image-designer',
    visible: Boolean(originKey && originKey === messageMapKey(state.activeId, state.activeTopicId)),
    ...fields,
  }).catch(() => undefined);
};

export interface ChatDallEAction {
  /**
   * Durable Stop mark for prepared chat-image tiles in this lane. Remembers
   * each task id locally first (same-browser reload backup), then persists
   * `taskCancelled` independently per message. Server cancelled-placeholders
   * are started by `tombstonePreparedChatImageTasks` before durable cancel.
   * Existing server tasks are still adopted. Callers must snapshot ids and
   * abort in-flight work before awaiting this.
   */
  cancelPreparedChatImageTasks: (
    sessionId: string,
    topicId?: string | null,
    threadId?: string | null,
  ) => Promise<void>;
  /**
   * Synchronously record every prepared unpaid chat-image task id in this lane
   * into the bounded local stop registry. Must run after the fence bump and
   * before any awaited durable-cancel / persist call.
   */
  rememberPreparedChatImageStopIds: (
    sessionId: string,
    topicId?: string | null,
    threadId?: string | null,
  ) => void;
  /**
   * Insert server cancelled-placeholders for unpaid prepared ids in this lane.
   * Call after the local abort and before awaiting unrelated durable cancel.
   */
  tombstonePreparedChatImageTasks: (
    sessionId: string,
    topicId?: string | null,
    threadId?: string | null,
  ) => Promise<void>;
  generateImageFromPrompts: (items: DallEImageItem[], id: string) => Promise<ChatImageRunOutcome>;
  /**
   * Recover items whose async task outlived this tab: adopt finished results,
   * resume waiting on pending ones, surface failures. For a provenance-valid
   * persisted id whose task row is missing (`task_missing`), it completes the
   * already-persisted attempt by idempotently resubmitting the SAME id — a
   * billable side effect, guarded by provenance, current-correlation re-read,
   * owner-config readiness, Stop authorization (`taskFence` + `taskCancelled`),
   * and the server-side correlation check. Unproven or Stopped ids never
   * generate automatically; they surface for explicit Retry.
   */
  reconcileDallETasks: (id: string) => Promise<void>;
  retryDallEImages: (id: string) => Promise<void>;
  text2image: (
    id: string,
    data: DallEImageItem[],
  ) => Promise<{
    data: unknown;
    outcome: ToolDiagnosticTerminalOutcome;
    shouldContinue: boolean;
  }>;
  toggleDallEImageLoading: (key: string, value: boolean) => void;
  updateImageItem: (
    id: string,
    updater: (data: DallEImageItem[]) => void,
    conversationContext?: ConversationContext,
  ) => Promise<void>;
  useFetchDalleImageItem: (id: string) => SWRResponse;
}

export const dalleSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatDallEAction
> = (set, get) => ({
  cancelPreparedChatImageTasks: async (sessionId, topicId, threadId) => {
    const prepared = snapshotAndRememberPreparedChatImageStops(get(), sessionId, topicId, threadId);

    const conversationContext: ConversationContext = {
      clearGeneration: resolveConversationClearGeneration(get(), sessionId, topicId, threadId),
      generation: get().conversationNavigationGeneration,
      sessionId,
      threadId,
      topicId,
    };

    const failures: unknown[] = [];
    for (const { items, message } of prepared) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await get().updateImageItem(
            message.id,
            (draft) => {
              for (const item of draft) {
                if (item?.taskId && !item.imageId) item.taskCancelled = true;
              }
            },
            conversationContext,
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!lastError) {
        for (const taskId of [
          ...new Set(
            items.filter((item) => item?.taskId && !item.imageId).map((item) => item.taskId!),
          ),
        ]) {
          forgetStoppedChatImageTask(taskId);
        }
        continue;
      }
      failures.push(lastError);
      const spanId = items
        .map((item) => resolvePersistedChatImageSpanId(item?.spanId))
        .find(Boolean);
      logChatImageGeneration(get(), 'chat_image_run_settled', {
        assistantMessageId: message.parentId || message.id,
        errorClass: lastError instanceof Error ? lastError.name : 'Error',
        itemCount: items.length,
        kind: 'stop_mark',
        outcome: 'persist_failed',
        sessionId,
        threadId,
        topicId,
        ...(spanId ? { spanId } : {}),
      });
    }
    if (failures[0]) throw failures[0];
  },
  rememberPreparedChatImageStopIds: (sessionId, topicId, threadId) => {
    snapshotAndRememberPreparedChatImageStops(get(), sessionId, topicId, threadId);
  },
  tombstonePreparedChatImageTasks: async (sessionId, topicId, threadId) => {
    const items = collectUnpaidChatImageStopTombstones(get(), sessionId, topicId, threadId);
    if (items.length === 0) return;
    try {
      await imageGenerationService.cancelUnstartedChatImageTasks(items);
    } catch {
      // Tombstone is best-effort. Local registry and message persist remain.
    }
  },
  generateImageFromPrompts: async (items, messageId) => {
    // Pin the originating conversation from the tool message itself — not the
    // currently visible topic. Leave-topic is not Stop; `getMessageById` only
    // reads the active map and would silently no-op after a switch. Stop is
    // the lane-scoped clear fence (plus thread id), not the global epoch.
    const origin = resolveOriginatingImageToolMessage(get(), messageId);
    if (!origin) {
      logChatImageGeneration(get(), 'chat_image_run_settled', {
        assistantMessageId: messageId,
        itemCount: items.length,
        kind: 'generate',
        outcome: 'no_origin',
      });
      return 'no_origin';
    }
    const originKey = origin.mapKey;
    const conversationContext = origin.conversationContext;
    const invocationIsCurrent = () => isImageToolFenceCurrent(get(), conversationContext);
    const persistItems = (updater: (data: DallEImageItem[]) => void) =>
      get().updateImageItem(messageId, updater, conversationContext);
    const assistantMessageId = origin.message.parentId || messageId;
    const debugSpanId = resolveChatImageDebugLane(
      get(),
      assistantMessageId,
      conversationContext.sessionId,
      conversationContext.topicId,
    )?.lane.spanId;
    const debugBase = {
      assistantMessageId,
      sessionId: conversationContext.sessionId,
      threadId: conversationContext.threadId,
      topicId: conversationContext.topicId,
    };
    const parseOriginItems = (): DallEImageItem[] => {
      const persisted = get().messagesMap[originKey]?.find((m) => m.id === messageId);
      try {
        const parsed = persisted ? (JSON.parse(persisted.content) as DallEImageItem[]) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const countOriginImages = () => {
      const parsed = parseOriginItems();
      return {
        attachedCount: parsed.filter((item) => Boolean(item?.imageId)).length,
        taskCount: parsed.filter((item) => Boolean(item?.taskId)).length,
      };
    };
    const resolveItemSpanId = (index: number) =>
      resolvePersistedChatImageSpanId(parseOriginItems()[index]?.spanId);
    const userState = useUserStore.getState();
    const userScope = authSelectors.currentUserScope(userState);
    const scopeAliases = listChatImageTaskIdScopeAliases({
      authenticatedScope: userScope,
      rawAuthUserId: userState.authUserId,
      userId: userState.user?.id,
    });

    // EXCLUSIVE OWNERSHIP FIRST (synchronously, before ANY await): claim every
    // index this run may generate for, under this run's token. An overlapping
    // same-tab invocation owns nothing and returns — it must never write ids.
    // (Cross-tab overlap is converged by the DETERMINISTIC ids instead: both
    // tabs derive the same id, so the server's idempotent insert + pending
    // claim yield exactly one paid task.)
    const runToken = Symbol('dalle-generation-run');
    const ownedIndices: number[] = [];
    for (const [index, item] of items.entries()) {
      if (item.imageId) continue;
      if (claimTaskKey(`${messageId}_${index}`, runToken)) ownedIndices.push(index);
    }
    if (ownedIndices.length === 0) {
      logChatImageGeneration(get(), 'chat_image_run_settled', {
        ...debugBase,
        ...countOriginImages(),
        itemCount: items.length,
        kind: 'generate',
        outcome: 'already_done',
        ownedCount: 0,
      });
      return 'already_done';
    }

    logChatImageGeneration(get(), 'chat_image_run_started', {
      ...debugBase,
      imageConfigReady: getImageStoreState().isInit,
      itemCount: items.length,
      kind: 'generate',
      ownedCount: ownedIndices.length,
    });
    let runOutcome: ChatImageRunOutcome = 'ok';

    try {
      if (!userScope) {
        runOutcome = 'persist_unproven';
        if (invocationIsCurrent()) {
          await get().updatePluginState(messageId, {
            error: items.map(() =>
              serializePluginError(
                new Error(
                  'The generation task could not be saved to this conversation, so nothing was generated or billed. Please retry.',
                ),
              ),
            ),
          });
        }
        return runOutcome;
      }

      const resolved = resolveImageModel();
      if (!resolved) {
        runOutcome = 'no_model';
        // no usable image model is configured — surface a per-item error
        // instead of silently generating nothing
        await get().updatePluginState(messageId, {
          error: items.map(() => ({ errorType: 'NoImageModelConfigured' })),
        });
        return runOutcome;
      }
      const { model, provider, params: baseParams } = resolved;

      // Conflict-aware correlation write with POSITIVE EVIDENCE: each id is
      // written only where the draft still matches the expectation (never
      // overwriting an id another writer persisted meanwhile), and
      // verification re-parses the originating message's persisted content at
      // the EXACT indices. Stop/clear can still skip the write; leave-topic
      // must not. Awaiting the persist call alone does not prove the ids landed.
      const persistTaskIdsChecked = async (
        writes: Map<number, { expected?: string; next: string; nextAttempt: number }>,
      ): Promise<{ parsed?: DallEImageItem[]; written: Set<number> }> => {
        const written = new Set<number>();
        if (writes.size === 0) return { written };
        await persistItems((draft) => {
          for (const [index, { expected, next, nextAttempt }] of writes) {
            const target = draft[index];
            if (!target || target.imageId) continue;
            if (expected === undefined ? Boolean(target.taskId) : target.taskId !== expected) {
              continue;
            }
            target.taskId = next;
            target.taskAttempt = nextAttempt;
            stampChatImageTaskAuthorization(
              target,
              conversationContext.clearGeneration,
              debugSpanId,
            );
            written.add(index);
          }
        });
        const persisted = get().messagesMap[originKey]?.find((m) => m.id === messageId);
        let parsed: DallEImageItem[] | undefined;
        try {
          parsed = persisted ? JSON.parse(persisted.content) : undefined;
        } catch {
          parsed = undefined;
        }
        if (!Array.isArray(parsed)) return { written: new Set() };
        for (const index of written) {
          const write = writes.get(index)!;
          if (
            parsed[index]?.taskId !== write.next ||
            parsed[index]?.taskAttempt !== write.nextAttempt
          ) {
            written.delete(index);
          }
        }
        return { parsed, written };
      };

      // WRITE-FIRST, ALL AT ONCE: derive the DETERMINISTIC id for every OWNED
      // item that needs a new generation and persist them in one checked write
      // BEFORE any billable request. Conflicting indices (an id appeared after
      // our snapshot) are ADOPTED, never overwritten; unproven writes create
      // nothing.
      const allocations = new Map<number, { next: string; nextAttempt: number }>();
      for (const index of ownedIndices) {
        if (!items[index].taskId) {
          allocations.set(index, {
            next: deriveChatImageTaskId(userScope, messageId, index, 0),
            nextAttempt: 0,
          });
        }
      }
      const casResult = await persistTaskIdsChecked(allocations);
      const effectiveTaskIds = new Map<number, { attempt: number; taskId: string }>();
      const freshlyAllocated = new Set<number>();
      let persistenceFailed = false;
      for (const index of ownedIndices) {
        const snapshotId = items[index].taskId;
        if (snapshotId) {
          effectiveTaskIds.set(index, {
            attempt: items[index].taskAttempt ?? 0,
            taskId: snapshotId,
          });
          continue;
        }
        if (casResult.written.has(index)) {
          effectiveTaskIds.set(index, { attempt: 0, taskId: allocations.get(index)!.next });
          freshlyAllocated.add(index);
          continue;
        }
        // not written: either another writer persisted an id meanwhile (adopt
        // it) or the write could not be proven (fail closed)
        const concurrent = casResult.parsed?.[index];
        if (concurrent?.taskId) {
          effectiveTaskIds.set(index, {
            attempt: concurrent.taskAttempt ?? 0,
            taskId: concurrent.taskId,
          });
        } else {
          persistenceFailed = true;
        }
      }
      if (persistenceFailed) {
        runOutcome = invocationIsCurrent() ? 'persist_unproven' : 'not_current';
        if (invocationIsCurrent()) {
          await get().updatePluginState(messageId, {
            error: items.map(() =>
              serializePluginError(
                new Error(
                  'The generation task could not be saved to this conversation, so nothing was generated or billed. Please retry.',
                ),
              ),
            ),
          });
        }
        return runOutcome;
      }

      const preexistingOwned = ownedIndices.filter((index) => Boolean(items[index].taskId));
      if (preexistingOwned.length > 0 && invocationIsCurrent()) {
        await persistItems((draft) => {
          for (const index of preexistingOwned) {
            const target = draft[index];
            if (!target || target.imageId) continue;
            stampChatImageTaskAuthorization(
              target,
              conversationContext.clearGeneration,
              debugSpanId,
            );
          }
        });
      }

      let persistUnprovenCount = 0;
      const results = await pMap(
        ownedIndices,
        async (index) => {
          const item = items[index];
          if (!invocationIsCurrent()) {
            logChatImageGeneration(get(), 'chat_image_item_settled', {
              ...debugBase,
              created: false,
              index,
              kind: 'generate',
              outcome: 'not_current',
            });
            return undefined;
          }

          const loadingKey = `${messageId}_${index}`;
          get().toggleDallEImageLoading(loadingKey, true);
          let created = false;
          let itemErrorClass: string | undefined;
          let itemOutcome: 'attached' | 'failed' | 'not_current' | 'persist_unproven' | 'skipped' =
            'skipped';

          try {
            // async-task pattern (same as the Image workspace): create the
            // task, then poll — never hold a request open for the 30–60 s
            // generation, and never let image bytes reach the message content
            const assigned = effectiveTaskIds.get(index);
            if (!assigned) return undefined;
            let { taskId, attempt } = assigned;

            // an id this run did NOT freshly allocate belongs to an existing
            // attempt (previous session, concurrent writer): adopt its result
            // (or resume waiting) BEFORE creating — Retry must never re-bill
            // a task that succeeded
            let mustCreate = freshlyAllocated.has(index);
            // an UNPROVEN id (e.g. restored content whose message id changed)
            // must never be submitted; in this EXPLICIT path it is replaced by
            // the derived attempt-0 id for the current message via the same
            // checked write, then created fresh
            if (
              !mustCreate &&
              !matchChatImageTaskIdScope(scopeAliases, messageId, index, taskId, attempt)
            ) {
              const derivedId = deriveChatImageTaskId(userScope, messageId, index, 0);
              const replaced = await persistTaskIdsChecked(
                new Map([[index, { expected: taskId, next: derivedId, nextAttempt: 0 }]]),
              );
              if (!replaced.written.has(index)) {
                itemOutcome = 'persist_unproven';
                return undefined;
              }
              if (!invocationIsCurrent()) {
                itemOutcome = 'not_current';
                return undefined;
              }
              taskId = derivedId;
              attempt = 0;
              mustCreate = true;
            }
            if (!mustCreate) {
              try {
                const adopted = await waitForChatImageTask(taskId, invocationIsCurrent, {
                  adoptProbe: true,
                  immediate: true,
                });
                if (!adopted.ok || !invocationIsCurrent()) {
                  itemOutcome = 'not_current';
                  return undefined;
                }
                if (adopted.file) {
                  await persistItems((draft) => {
                    if (draft[index]) {
                      draft[index].imageId = adopted.file!.id;
                      draft[index].previewUrl = undefined;
                    }
                  });
                  created = false;
                  itemOutcome = 'attached';
                  return undefined;
                }
                // not_found: the persisted id's task row does not exist (a
                // failed earlier create, or another tab's create still in
                // flight). Deterministic ids make re-submitting the SAME id
                // safe and idempotent — recover by creating it, never by
                // replacing it.
                if (adopted.notFound) mustCreate = true;
              } catch (error) {
                // ONLY an authoritative terminal task state (server said
                // "error") justifies a replacement. Lookup, transport, auth
                // and local-timeout failures say nothing about the task —
                // surface them without creating a duplicate charge.
                if (!isTerminalTaskStateError(error)) throw error;
                // the status request awaited across arbitrary time — re-check
                // ownership before doing anything billable
                if (!invocationIsCurrent()) {
                  itemOutcome = 'not_current';
                  return undefined;
                }
                // the replacement is the NEXT ATTEMPT of the same tuple (both
                // tabs derive it from the persisted attempt counter) and must
                // pass the same checked write BEFORE its task is created; the
                // expectation pins the failed id
                const nextAttempt = attempt + 1;
                const replacementId = deriveChatImageTaskId(
                  userScope,
                  messageId,
                  index,
                  nextAttempt,
                );
                const replaced = await persistTaskIdsChecked(
                  new Map([[index, { expected: taskId, next: replacementId, nextAttempt }]]),
                );
                if (!replaced.written.has(index)) {
                  itemOutcome = 'persist_unproven';
                  return undefined;
                }
                if (!invocationIsCurrent()) {
                  itemOutcome = 'not_current';
                  return undefined;
                }
                taskId = replacementId;
                attempt = nextAttempt;
                mustCreate = true;
              }
            }

            if (mustCreate) {
              const spanId =
                resolvePersistedChatImageSpanId(debugSpanId) ?? resolveItemSpanId(index);
              await imageGenerationService.createChatImageTask({
                correlation: { index, messageId },
                model,
                params: { ...baseParams, prompt: item.prompt },
                provider,
                ...(spanId ? { spanId } : {}),
                taskId,
              });
              created = true;
              if (!invocationIsCurrent()) {
                itemOutcome = 'not_current';
                return undefined;
              }
            }

            const { ok, file } = await waitForChatImageTask(taskId, invocationIsCurrent);
            if (!ok || !invocationIsCurrent()) {
              itemOutcome = 'not_current';
              return undefined;
            }
            if (!file) throw new Error('The image provider returned an empty result.');

            await persistItems((draft) => {
              if (draft[index]) {
                draft[index].imageId = file.id;
                draft[index].previewUrl = undefined;
              }
            });
            itemOutcome = 'attached';
            return undefined;
          } catch (error) {
            if (!invocationIsCurrent()) {
              itemOutcome = 'not_current';
              return undefined;
            }
            itemOutcome = 'failed';
            itemErrorClass = error instanceof Error ? error.name : 'Error';
            // clear the (possibly expiring) previewUrl so the UI never shows
            // a soon-to-be-broken image, and record the failure for this index
            await persistItems((draft) => {
              if (draft[index]) draft[index].previewUrl = undefined;
            });
            return {
              error,
              errorClass: error instanceof Error ? error.name : 'Error',
              index,
            };
          } finally {
            if (itemOutcome === 'skipped' && !invocationIsCurrent()) {
              itemOutcome = 'not_current';
            }
            if (itemOutcome === 'persist_unproven') persistUnprovenCount += 1;
            logChatImageGeneration(get(), 'chat_image_item_settled', {
              ...debugBase,
              created,
              errorClass: itemErrorClass,
              index,
              kind: 'generate',
              outcome: itemOutcome,
            });
            releaseTaskKey(loadingKey, runToken);
            get().toggleDallEImageLoading(loadingKey, false);
          }
        },
        { concurrency: 3 },
      );

      if (!invocationIsCurrent()) {
        runOutcome = 'not_current';
        return runOutcome;
      }

      // set plugin error ONCE, after all items settle, to avoid the concurrent
      // read-modify-write race the previous shared-array approach had
      const failures = results.filter(
        (r): r is { error: unknown; index: number } => r !== undefined,
      );
      if (failures.length > 0) {
        runOutcome = failures.length === ownedIndices.length ? 'failed' : 'partial';
        const errorArray: unknown[] = [];
        for (const f of failures) errorArray[f.index] = serializePluginError(f.error);
        await get().updatePluginState(messageId, { error: errorArray });
      } else if (persistUnprovenCount > 0) {
        runOutcome = persistUnprovenCount === ownedIndices.length ? 'persist_unproven' : 'partial';
      }
      return runOutcome;
    } catch (error) {
      if (runOutcome === 'ok') runOutcome = 'failed';
      throw error;
    } finally {
      logChatImageGeneration(get(), 'chat_image_run_settled', {
        ...debugBase,
        ...countOriginImages(),
        imageConfigReady: getImageStoreState().isInit,
        itemCount: items.length,
        kind: 'generate',
        outcome: runOutcome,
        ownedCount: ownedIndices.length,
      });
      // function-level cleanup: release every key STILL owned by this run
      // (token-checked, so an index a later invocation legitimately reclaimed
      // after its per-item release is never stolen). Without this, a stale
      // return or a thrown persistence/config failure would leak the claim
      // and make reconcile/Retry silently no-op until a full reload.
      for (const index of ownedIndices) releaseTaskKey(`${messageId}_${index}`, runToken);
    }
  },
  reconcileDallETasks: async (messageId) => {
    const origin = resolveOriginatingImageToolMessage(get(), messageId);
    if (!origin) return;
    const conversationContext = origin.conversationContext;
    const invocationIsCurrent = () => isImageToolFenceCurrent(get(), conversationContext);
    const reconcileToken = Symbol('dalle-reconcile-run');
    const assistantMessageId = origin.message.parentId || messageId;
    const debugSpanId = resolveChatImageDebugLane(
      get(),
      assistantMessageId,
      conversationContext.sessionId,
      conversationContext.topicId,
    )?.lane.spanId;

    const message = origin.message;

    let items: DallEImageItem[];
    try {
      items = JSON.parse(message.content);
    } catch {
      return;
    }
    if (!Array.isArray(items)) return;

    const needsWork = items.some((item) => item && !item.imageId);
    const errorArray: unknown[] = [];
    let hasError = false;
    await pMap(
      items,
      async (item, index) => {
        // Prompt-only tiles (stale fetch wiped `taskId`/`imageId`) still have
        // a deterministic task id. Adopt a finished file from that slot;
        // never auto-create — that would bill a generation the user already paid.
        if (!item || item.imageId) return;
        const linkedFileId = singletonLinkedChatImageId(items.length, origin.message.imageList);
        const loadingKey = `${messageId}_${index}`;
        if (!claimTaskKey(loadingKey, reconcileToken)) return;
        get().toggleDallEImageLoading(loadingKey, true);

        try {
          if (linkedFileId) {
            await get().updateImageItem(
              messageId,
              (draft) => {
                if (draft[index]) {
                  draft[index].imageId = linkedFileId;
                  draft[index].previewUrl = undefined;
                }
              },
              conversationContext,
            );
            return;
          }
          if (!item.taskId) {
            let slot;
            try {
              slot = await imageGenerationService.getChatImageSlotResult({
                index,
                messageId,
              });
            } catch (error) {
              hasError = true;
              errorArray[index] = isChatImageStopTombstoneError(error)
                ? { errorType: CHAT_IMAGE_TASK_CANCELLED_ERROR }
                : serializePluginError(error);
              return;
            }
            const slotStatus = (slot.status ?? '').toLowerCase();
            if (slot.status === 'success' && slot.file && invocationIsCurrent()) {
              await get().updateImageItem(
                messageId,
                (draft) => {
                  if (draft[index]) {
                    draft[index].imageId = slot.file!.id;
                    draft[index].previewUrl = undefined;
                    if (slot.taskAttempt !== undefined) {
                      draft[index].taskAttempt = slot.taskAttempt;
                    }
                    if (slot.taskId) draft[index].taskId = slot.taskId;
                  }
                },
                conversationContext,
              );
              return;
            }
            if (
              slot.taskId &&
              slotStatus !== 'task_missing' &&
              slotStatus !== 'not_found' &&
              invocationIsCurrent()
            ) {
              const recovered = await recoverChatImageSlotAliases({
                attempt: slot.taskAttempt,
                index,
                invocationIsCurrent,
                messageId,
                preferredTaskId: slot.taskId,
              });
              if (!invocationIsCurrent()) return;
              if (recovered.ok && recovered.file) {
                await get().updateImageItem(
                  messageId,
                  (draft) => {
                    if (draft[index]) {
                      draft[index].imageId = recovered.file.id;
                      draft[index].previewUrl = undefined;
                      if (slot.taskAttempt !== undefined) {
                        draft[index].taskAttempt = slot.taskAttempt;
                      }
                      draft[index].taskId = recovered.taskId;
                    }
                  },
                  conversationContext,
                );
                return;
              }
              if (recovered.error) {
                hasError = true;
                errorArray[index] = isChatImageStopTombstoneError(recovered.error)
                  ? { errorType: CHAT_IMAGE_TASK_CANCELLED_ERROR }
                  : serializePluginError(recovered.error);
              }
              return;
            }
            const reconcileUserState = useUserStore.getState();
            const reconcileScopes = listChatImageTaskIdScopeAliases({
              authenticatedScope: authSelectors.currentUserScope(reconcileUserState),
              rawAuthUserId: reconcileUserState.authUserId,
              userId: reconcileUserState.user?.id,
            });
            const probes = await Promise.all(
              reconcileScopes.map(async (scope) => {
                const taskId = deriveChatImageTaskId(scope, messageId, index, 0);
                try {
                  const result = await waitForChatImageTask(taskId, invocationIsCurrent, {
                    adoptProbe: true,
                    immediate: true,
                  });
                  return { attempt: 0, result, taskId };
                } catch (error) {
                  return { attempt: 0, error, taskId };
                }
              }),
            );
            if (!invocationIsCurrent()) return;
            // Alias order is the recovery priority. Settle each probe so one
            // terminal legacy scope cannot hide a successful file on another.
            const recovered = probes.find((probe) => probe.result?.ok && probe.result.file);
            if (recovered?.result?.file) {
              await get().updateImageItem(
                messageId,
                (draft) => {
                  if (draft[index]) {
                    draft[index].imageId = recovered.result!.file!.id;
                    draft[index].previewUrl = undefined;
                    draft[index].taskAttempt = recovered.attempt;
                    draft[index].taskId = recovered.taskId;
                  }
                },
                conversationContext,
              );
              return;
            }
            const terminal = probes.find((probe) => isTerminalTaskStateError(probe.error));
            if (terminal?.error) {
              hasError = true;
              errorArray[index] = isChatImageStopTombstoneError(terminal.error)
                ? { errorType: CHAT_IMAGE_TASK_CANCELLED_ERROR }
                : serializePluginError(terminal.error);
              return;
            }
            // Permanent lookup failures (4xx / timeout) used to reach the outer
            // catch via Promise.all. Settling probes must still surface them so
            // the tile gets an error card + Retry; pure task_missing stays silent.
            const lookupError = probes.find((probe) => probe.error);
            if (lookupError?.error) {
              hasError = true;
              errorArray[index] = serializePluginError(lookupError.error);
            }
            return;
          }

          // adopt probe first: a persisted id whose task row is MISSING must
          // not be polled for the whole budget (that would hold this key and
          // silently dead-lock Retry) — it is recovered by idempotently
          // submitting the SAME deterministic id, completing the intended
          // (already persisted) attempt.
          const probe = await waitForChatImageTask(item.taskId, invocationIsCurrent, {
            adoptProbe: true,
            immediate: true,
          });
          if (!probe.ok || !invocationIsCurrent()) return;
          if (probe.notFound) {
            // AUTOMATIC resubmission is billable — every gate below must pass.
            // 1) provenance: only an id derivable for (user, message, index)
            //    may auto-generate; restored/arbitrary ids surface for Retry
            const reconcileUserState = useUserStore.getState();
            const reconcileScopes = listChatImageTaskIdScopeAliases({
              authenticatedScope: authSelectors.currentUserScope(reconcileUserState),
              rawAuthUserId: reconcileUserState.authUserId,
              userId: reconcileUserState.user?.id,
            });
            if (
              !matchChatImageTaskIdScope(
                reconcileScopes,
                messageId,
                index,
                item.taskId,
                item.taskAttempt ?? 0,
              )
            ) {
              hasError = true;
              // a stable type, localized by the error card ("came from a
              // restore — use Retry"), never hard-coded English copy
              errorArray[index] = { errorType: 'ChatImageTaskUnverified' };
              return;
            }
            // 2) owner config readiness: "still initializing" must not become
            //    a false no-model error — bounded wait with a final readiness
            //    check at the deadline; if it truly expires unready, the
            //    renderer's isInit subscription re-runs reconciliation when
            //    hydration settles (no new view or remount needed)
            if (!(await waitForImageConfigReady(invocationIsCurrent))) return;
            const resolved = resolveImageModel();
            if (!resolved) {
              hasError = true;
              errorArray[index] = { errorType: 'NoImageModelConfigured' };
              return;
            }
            // 3) current correlation: the message must still exist and still
            //    carry this exact unresolved id (deletion/mutation guard; the
            //    server re-verifies the same correlation before insert)
            const current = get().messagesMap[origin.mapKey]?.find((m) => m.id === messageId);
            if (!current) return;
            let currentItems: DallEImageItem[] | undefined;
            try {
              currentItems = JSON.parse(current.content);
            } catch {
              return;
            }
            const currentItem = currentItems?.[index];
            if (!currentItem || currentItem.taskId !== item.taskId || currentItem.imageId) {
              return;
            }
            // 4) Stop authorization: auto-create is billable. Same-session Stop
            //    is a stale prepared fence vs the live (non-zero) lane fence.
            //    Reload zeros that fence, so authorization then is
            //    `taskCancelled` / remembered stop id / cancelled-placeholder
            //    probe, not a compare-to-zero. A missing fence (legacy tile)
            //    fails closed. Existing server tasks are adopted above this
            //    gate and are never discarded.
            if (!isChatImageAutoCreateAuthorized(currentItem, get(), conversationContext)) {
              hasError = true;
              errorArray[index] = { errorType: 'ChatImageTaskCancelled' };
              return;
            }
            const spanId = resolvePersistedChatImageSpanId(currentItem.spanId) ?? debugSpanId;
            await imageGenerationService.createChatImageTask({
              correlation: { index, messageId },
              model: resolved.model,
              params: { ...resolved.params, prompt: item.prompt },
              provider: resolved.provider,
              ...(spanId ? { spanId } : {}),
              taskId: item.taskId,
            });
            if (!invocationIsCurrent()) return;
          }

          const { ok, file } = probe.file
            ? { file: probe.file, ok: true }
            : await waitForChatImageTask(item.taskId, invocationIsCurrent, {
                immediate: probe.notFound !== true,
              });
          if (!ok || !invocationIsCurrent()) return;
          if (!file) return;
          await get().updateImageItem(
            messageId,
            (draft) => {
              if (draft[index]) {
                draft[index].imageId = file.id;
                draft[index].previewUrl = undefined;
              }
            },
            conversationContext,
          );
        } catch (error) {
          if (!invocationIsCurrent()) return;
          hasError = true;
          errorArray[index] = isChatImageStopTombstoneError(error)
            ? { errorType: CHAT_IMAGE_TASK_CANCELLED_ERROR }
            : serializePluginError(error);
        } finally {
          releaseTaskKey(loadingKey, reconcileToken);
          get().toggleDallEImageLoading(loadingKey, false);
        }
      },
      { concurrency: 3 },
    );

    if (hasError && invocationIsCurrent()) {
      await get().updatePluginState(messageId, { error: errorArray });
    }
    if (needsWork && invocationIsCurrent()) {
      let attachedCount = 0;
      try {
        const latest = JSON.parse(
          get().messagesMap[origin.mapKey]?.find((m) => m.id === messageId)?.content ?? '',
        ) as DallEImageItem[];
        attachedCount = Array.isArray(latest)
          ? latest.filter((item) => Boolean(item?.imageId)).length
          : 0;
      } catch {
        attachedCount = 0;
      }
      logChatImageGeneration(get(), 'chat_image_run_settled', {
        assistantMessageId,
        attachedCount,
        itemCount: items.length,
        kind: 'reconcile',
        outcome: hasError ? 'partial' : attachedCount > 0 ? 'ok' : 'task_missing',
        sessionId: conversationContext.sessionId,
        threadId: conversationContext.threadId,
        topicId: conversationContext.topicId,
        ...(debugSpanId ? { spanId: debugSpanId } : {}),
      });
    }
  },
  retryDallEImages: async (messageId) => {
    const message = chatSelectors.getMessageById(messageId)(get());
    if (!message) return;

    const items: DallEImageItem[] = JSON.parse(message.content);
    // clear prior errors, then regenerate only the items still missing an image
    // (generateImageFromPrompts skips any item that already has an imageId), so
    // retrying one failure never re-generates or re-bills the successful ones
    await get().updatePluginState(messageId, { error: undefined });
    await get().generateImageFromPrompts(items, messageId);
  },
  text2image: async (id, data) => {
    const runOutcome = await get().generateImageFromPrompts(data, id);
    return toText2ImageInvocation(runOutcome, data);
  },

  toggleDallEImageLoading: (key, value) => {
    set(
      { dalleImageLoading: { ...get().dalleImageLoading, [key]: value } },
      false,
      n('toggleDallEImageLoading'),
    );
  },

  updateImageItem: async (id, updater, conversationContext) => {
    // serialize whole-message item writes per message: concurrent items each
    // read content and write the WHOLE array back, so unserialized writes
    // (e.g. item 2's taskId vs item 1's imageId) would clobber each other
    const previous = imageItemUpdateQueues.get(id) ?? Promise.resolve();
    const task = previous.then(async () => {
      const origin = resolveOriginatingImageToolMessage(get(), id);
      if (!origin) return;

      const data: DallEImageItem[] = JSON.parse(origin.message.content);

      const nextContent = produce(data, updater);
      const imageList: ChatImageItem[] = nextContent
        .filter((item) => Boolean(item?.imageId))
        .map((item) => ({
          alt: item.prompt,
          id: item.imageId as string,
          url: '',
        }));
      await get().internal_updateMessageContent(id, JSON.stringify(nextContent), {
        conversationContext: conversationContext ?? origin.conversationContext,
        ...(imageList.length > 0 ? { imageList } : {}),
        // Each tile persist used to revalidate the whole conversation. A fetch
        // that started before this write (or an overlapping send/focus
        // revalidate) can return prompt-only content and wipe `imageId` from
        // the visible map — Artifacts still have the file. Skip that refresh;
        // `useFetchMessages` also merges file/task ids if a later fetch is stale.
        skipRefresh: true,
      });
    });
    const settled = task.catch(() => {});
    imageItemUpdateQueues.set(id, settled);
    try {
      await task;
    } finally {
      if (imageItemUpdateQueues.get(id) === settled) imageItemUpdateQueues.delete(id);
    }
  },

  useFetchDalleImageItem: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR(
      requestedScope ? [SWR_FETCH_KEY, requestedScope, id] : null,
      async () => {
        if (!requestedScope) return null;
        const requestedGeneration = get().conversationClearGeneration;
        if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return null;

        const item = await fileService.getFile(id);
        if (
          authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
          get().conversationClearGeneration !== requestedGeneration
        )
          return item;

        set(
          produce((draft) => {
            if (draft.dalleImageMap[id]) return;

            draft.dalleImageMap[id] = item;
          }),
          false,
          n('useFetchFile'),
        );

        return item;
      },
    );
  },
});
