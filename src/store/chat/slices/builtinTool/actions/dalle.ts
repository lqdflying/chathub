import { produce } from 'immer';
import { sha256 } from 'js-sha256';
import { omit } from 'lodash-es';
import { RuntimeImageGenParams } from 'model-bank';
import pMap from 'p-map';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { findRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { fileService } from '@/services/file';
import { imageGenerationService } from '@/services/textToImage';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
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
  // initial default (openai/gpt-image-1), which must NOT be used to bill a
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

// DETERMINISTIC task ids — SHA-256-derived, RFC-4122-shaped (the version-5
// nibble is set only for UUID-schema compatibility; this is NOT SHA-1 UUIDv5).
// Every tab derives the SAME id for the same (user, message, item, attempt),
// so a cross-tab overlap
// cannot create two different paid tasks — the server's idempotent same-id
// insert plus the pending-claim dedup collapse duplicate submissions into one
// task, and both tabs adopt the same result. Replacement attempts chain
// deterministically from the terminally-failed id for the same reason.
const CHAT_IMAGE_TASK_SEED = 'chathub-chat-image-task';
const deriveDeterministicTaskId = (seed: string): string => {
  const bytes = new Uint8Array(sha256.arrayBuffer(seed)).slice(0, 16);
  // decimal to stay neutral in the prettier/unicorn hex-casing conflict:
  // 15/80 = version-5 nibble, 63/128 = RFC-4122 variant
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const deriveInitialTaskId = (userScope: string, messageId: string, index: number) =>
  deriveDeterministicTaskId(`${CHAT_IMAGE_TASK_SEED}:${userScope}:${messageId}:${index}:0`);
const deriveReplacementTaskId = (failedTaskId: string) =>
  deriveDeterministicTaskId(`${CHAT_IMAGE_TASK_SEED}:replacement:${failedTaskId}`);

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
// the server (status error / not_found) — as opposed to lookup/transport
// failures or local timeouts, which say nothing about the task itself and must
// never justify creating a replacement (billable) generation.
const isTerminalTaskStateError = (error: unknown) =>
  Boolean((error as { taskTerminal?: boolean })?.taskTerminal);

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

export interface ChatDallEAction {
  generateImageFromPrompts: (items: DallEImageItem[], id: string) => Promise<void>;
  /**
   * Recover items whose async task outlived this tab: adopt finished results,
   * resume waiting on pending ones, surface failures. Never creates tasks.
   */
  reconcileDallETasks: (id: string) => Promise<void>;
  retryDallEImages: (id: string) => Promise<void>;
  text2image: (id: string, data: DallEImageItem[]) => Promise<void>;
  toggleDallEImageLoading: (key: string, value: boolean) => void;
  updateImageItem: (id: string, updater: (data: DallEImageItem[]) => void) => Promise<void>;
  useFetchDalleImageItem: (id: string) => SWRResponse;
}

export const dalleSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatDallEAction
> = (set, get) => ({
  generateImageFromPrompts: async (items, messageId) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;
    // the originating conversation's map key, captured while it is active —
    // write verification below reads THIS key, never the currently-active one
    const originKey = messageMapKey(get().activeId, get().activeTopicId);
    const userScope = authSelectors.currentUserScope(useUserStore.getState()) ?? 'anonymous';

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
    if (ownedIndices.length === 0) return;

    try {
      const message = chatSelectors.getMessageById(messageId)(get());
      if (!message) return;

      const resolved = resolveImageModel();
      if (!resolved) {
        // no usable image model is configured — surface a per-item error
        // instead of silently generating nothing
        await get().updatePluginState(messageId, {
          error: items.map(() => ({ errorType: 'NoImageModelConfigured' })),
        });
        return;
      }
      const { model, provider, params: baseParams } = resolved;

      // Conflict-aware correlation write with POSITIVE EVIDENCE: each id is
      // written only where the draft still matches the expectation (never
      // overwriting an id another writer persisted meanwhile), and
      // verification re-parses the originating message's persisted content at
      // the EXACT indices — the layers under `updateImageItem` can silently
      // no-op on navigation/stale ownership, so awaiting alone proves nothing.
      const persistTaskIdsChecked = async (
        writes: Map<number, { expected?: string; next: string }>,
      ): Promise<{ parsed?: DallEImageItem[]; written: Set<number> }> => {
        const written = new Set<number>();
        if (writes.size === 0) return { written };
        await get().updateImageItem(messageId, (draft) => {
          for (const [index, { expected, next }] of writes) {
            const target = draft[index];
            if (!target || target.imageId) continue;
            if (expected === undefined ? Boolean(target.taskId) : target.taskId !== expected) {
              continue;
            }
            target.taskId = next;
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
          if (parsed[index]?.taskId !== writes.get(index)!.next) written.delete(index);
        }
        return { parsed, written };
      };

      // WRITE-FIRST, ALL AT ONCE: derive the DETERMINISTIC id for every OWNED
      // item that needs a new generation and persist them in one checked write
      // BEFORE any billable request. Conflicting indices (an id appeared after
      // our snapshot) are ADOPTED, never overwritten; unproven writes create
      // nothing.
      const allocations = new Map<number, { next: string }>();
      for (const index of ownedIndices) {
        if (!items[index].taskId) {
          allocations.set(index, { next: deriveInitialTaskId(userScope, messageId, index) });
        }
      }
      const casResult = await persistTaskIdsChecked(allocations);
      const effectiveTaskIds = new Map<number, string>();
      const freshlyAllocated = new Set<number>();
      let persistenceFailed = false;
      for (const index of ownedIndices) {
        const snapshotId = items[index].taskId;
        if (snapshotId) {
          effectiveTaskIds.set(index, snapshotId);
          continue;
        }
        if (casResult.written.has(index)) {
          effectiveTaskIds.set(index, allocations.get(index)!.next);
          freshlyAllocated.add(index);
          continue;
        }
        // not written: either another writer persisted an id meanwhile (adopt
        // it) or the write could not be proven (fail closed)
        const concurrentId = casResult.parsed?.[index]?.taskId;
        if (concurrentId) {
          effectiveTaskIds.set(index, concurrentId);
        } else {
          persistenceFailed = true;
        }
      }
      if (persistenceFailed) {
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
        return;
      }

      const results = await pMap(
        ownedIndices,
        async (index) => {
          const item = items[index];
          if (!invocationIsCurrent()) return undefined;

          const loadingKey = `${messageId}_${index}`;
          get().toggleDallEImageLoading(loadingKey, true);

          try {
            // async-task pattern (same as the Image workspace): create the
            // task, then poll — never hold a request open for the 30–60 s
            // generation, and never let image bytes reach the message content
            let taskId = effectiveTaskIds.get(index);
            if (!taskId) return undefined;

            // an id this run did NOT freshly allocate belongs to an existing
            // attempt (previous session, concurrent writer): adopt its result
            // (or resume waiting) BEFORE creating — Retry must never re-bill
            // a task that succeeded
            let mustCreate = freshlyAllocated.has(index);
            if (!mustCreate) {
              try {
                const adopted = await waitForChatImageTask(taskId, invocationIsCurrent, {
                  adoptProbe: true,
                  immediate: true,
                });
                if (!adopted.ok || !invocationIsCurrent()) return undefined;
                if (adopted.file) {
                  await get().updateImageItem(messageId, (draft) => {
                    if (draft[index]) {
                      draft[index].imageId = adopted.file!.id;
                      draft[index].previewUrl = undefined;
                    }
                  });
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
                if (!invocationIsCurrent()) return undefined;
                // the replacement id is DERIVED from the failed id (both tabs
                // agree on it) and must pass the same checked write BEFORE
                // its task is created; the expectation pins the failed id
                const replacementId = deriveReplacementTaskId(taskId);
                const replaced = await persistTaskIdsChecked(
                  new Map([[index, { expected: taskId, next: replacementId }]]),
                );
                if (!replaced.written.has(index)) return undefined;
                if (!invocationIsCurrent()) return undefined;
                taskId = replacementId;
                mustCreate = true;
              }
            }

            if (mustCreate) {
              await imageGenerationService.createChatImageTask({
                model,
                params: { ...baseParams, prompt: item.prompt },
                provider,
                taskId,
              });
              if (!invocationIsCurrent()) return undefined;
            }

            const { ok, file } = await waitForChatImageTask(taskId, invocationIsCurrent);
            if (!ok || !invocationIsCurrent()) return undefined;
            if (!file) throw new Error('The image provider returned an empty result.');

            await get().updateImageItem(messageId, (draft) => {
              if (draft[index]) {
                draft[index].imageId = file.id;
                draft[index].previewUrl = undefined;
              }
            });
            return undefined;
          } catch (error) {
            if (!invocationIsCurrent()) return undefined;
            // clear the (possibly expiring) previewUrl so the UI never shows
            // a soon-to-be-broken image, and record the failure for this index
            await get().updateImageItem(messageId, (draft) => {
              if (draft[index]) draft[index].previewUrl = undefined;
            });
            return { error, index };
          } finally {
            releaseTaskKey(loadingKey, runToken);
            get().toggleDallEImageLoading(loadingKey, false);
          }
        },
        { concurrency: 3 },
      );

      if (!invocationIsCurrent()) return;

      // set plugin error ONCE, after all items settle, to avoid the concurrent
      // read-modify-write race the previous shared-array approach had
      const failures = results.filter(
        (r): r is { error: unknown; index: number } => r !== undefined,
      );
      if (failures.length > 0) {
        const errorArray: unknown[] = [];
        for (const f of failures) errorArray[f.index] = serializePluginError(f.error);
        await get().updatePluginState(messageId, { error: errorArray });
      }
    } finally {
      // function-level cleanup: release every key STILL owned by this run
      // (token-checked, so an index a later invocation legitimately reclaimed
      // after its per-item release is never stolen). Without this, a stale
      // return or a thrown persistence/config failure would leak the claim
      // and make reconcile/Retry silently no-op until a full reload.
      for (const index of ownedIndices) releaseTaskKey(`${messageId}_${index}`, runToken);
    }
  },
  reconcileDallETasks: async (messageId) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;
    const reconcileToken = Symbol('dalle-reconcile-run');

    const message = chatSelectors.getMessageById(messageId)(get());
    if (!message) return;

    let items: DallEImageItem[];
    try {
      items = JSON.parse(message.content);
    } catch {
      return;
    }
    if (!Array.isArray(items)) return;

    const errorArray: unknown[] = [];
    let hasError = false;
    await pMap(
      items,
      async (item, index) => {
        // only items whose task outlived this tab and never resolved
        if (!item?.taskId || item.imageId) return;
        const loadingKey = `${messageId}_${index}`;
        if (!claimTaskKey(loadingKey, reconcileToken)) return;
        get().toggleDallEImageLoading(loadingKey, true);

        try {
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
            const resolved = resolveImageModel();
            if (!resolved) {
              hasError = true;
              errorArray[index] = { errorType: 'NoImageModelConfigured' };
              return;
            }
            await imageGenerationService.createChatImageTask({
              model: resolved.model,
              params: { ...resolved.params, prompt: item.prompt },
              provider: resolved.provider,
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
          await get().updateImageItem(messageId, (draft) => {
            if (draft[index]) {
              draft[index].imageId = file.id;
              draft[index].previewUrl = undefined;
            }
          });
        } catch (error) {
          if (!invocationIsCurrent()) return;
          hasError = true;
          errorArray[index] = serializePluginError(error);
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
    await get().generateImageFromPrompts(data, id);
  },

  toggleDallEImageLoading: (key, value) => {
    set(
      { dalleImageLoading: { ...get().dalleImageLoading, [key]: value } },
      false,
      n('toggleDallEImageLoading'),
    );
  },

  updateImageItem: async (id, updater) => {
    // serialize whole-message item writes per message: concurrent items each
    // read content and write the WHOLE array back, so unserialized writes
    // (e.g. item 2's taskId vs item 1's imageId) would clobber each other
    const previous = imageItemUpdateQueues.get(id) ?? Promise.resolve();
    const task = previous.then(async () => {
      const message = chatSelectors.getMessageById(id)(get());
      if (!message) return;

      const data: DallEImageItem[] = JSON.parse(message.content);

      const nextContent = produce(data, updater);
      await get().internal_updateMessageContent(id, JSON.stringify(nextContent));
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
