import { produce } from 'immer';
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

// Tasks currently being polled in this tab, keyed `${messageId}_${index}` —
// prevents the render-mount reconciler and an active generation loop from
// double-polling the same item.
const inFlightTaskKeys = new Set<string>();

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
  options?: { immediate?: boolean },
): Promise<{ file?: { height?: number; id: string; width?: number }; ok: boolean }> => {
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
    if (TERMINAL_TASK_STATUSES.has(status) || status === 'not_found') {
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

    const message = chatSelectors.getMessageById(messageId)(get());
    if (!message) return;

    const resolved = resolveImageModel();
    if (!resolved) {
      // no usable image model is configured — surface a per-item error instead
      // of silently generating nothing
      await get().updatePluginState(messageId, {
        error: items.map(() => ({ errorType: 'NoImageModelConfigured' })),
      });
      return;
    }
    const { model, provider, params: baseParams } = resolved;

    // POSITIVE-EVIDENCE persistence: write task ids and then verify they are
    // present in the originating message's persisted content. `updateImageItem`
    // (and the layers under it) can silently no-op when the conversation was
    // switched or ownership went stale — awaiting it proves nothing, and a
    // billable task must NEVER be created on an unproven correlation.
    const persistTaskIdsVerified = async (allocations: Map<number, string>): Promise<boolean> => {
      if (allocations.size === 0) return true;
      await get().updateImageItem(messageId, (draft) => {
        for (const [index, id] of allocations) {
          if (draft[index]) draft[index].taskId = id;
        }
      });
      const persisted = get().messagesMap[originKey]?.find((m) => m.id === messageId);
      if (!persisted) return false;
      return [...allocations.values()].every((id) => persisted.content.includes(id));
    };

    // WRITE-FIRST, ALL AT ONCE: allocate ids for every item that needs a new
    // generation and persist them in ONE origin-verified write BEFORE any
    // billable request is launched. If the write cannot be proven, no task is
    // created at all.
    const allocations = new Map<number, string>();
    for (const [index, item] of items.entries()) {
      if (!item.imageId && !item.taskId) allocations.set(index, crypto.randomUUID());
    }
    if (!(await persistTaskIdsVerified(allocations))) {
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
      items,
      async (item, index) => {
        if (!invocationIsCurrent()) return undefined;
        // skip items that already have an uploaded image (e.g. on retry) so a
        // partial failure never re-generates and re-bills the successful ones
        if (item.imageId) return undefined;

        // key loading by index (duplicate prompts would otherwise collide)
        const loadingKey = `${messageId}_${index}`;
        if (inFlightTaskKeys.has(loadingKey)) return undefined;
        inFlightTaskKeys.add(loadingKey);
        get().toggleDallEImageLoading(loadingKey, true);

        try {
          // async-task pattern (same as the Image workspace): create the task,
          // then poll — never hold a request open for the 30–60 s generation,
          // and never let multi-MB image data reach the browser/message content
          // the id was pre-allocated and origin-verified in the single write
          // above — an item that had neither an image nor a task always has one
          let taskId = item.taskId ?? allocations.get(index);

          // an item may already carry a task from a previous session/attempt:
          // adopt its result (or resume waiting) BEFORE creating a new billable
          // generation — Retry must never re-bill a task that succeeded
          if (item.taskId) {
            try {
              const adopted = await waitForChatImageTask(item.taskId, invocationIsCurrent, {
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
            } catch (error) {
              // ONLY an authoritative terminal task state (server said
              // error/not_found) justifies a replacement generation. Lookup,
              // transport, auth and local-timeout failures say nothing about
              // the task — surface them without creating a duplicate charge.
              if (!isTerminalTaskStateError(error)) throw error;
              // the status request awaited across arbitrary time — re-check
              // ownership before doing anything billable
              if (!invocationIsCurrent()) return undefined;
              // the replacement id must be origin-verified BEFORE its task is
              // created, exactly like the initial allocation
              const replacementId = crypto.randomUUID();
              if (!(await persistTaskIdsVerified(new Map([[index, replacementId]])))) {
                return undefined;
              }
              if (!invocationIsCurrent()) return undefined;
              taskId = replacementId;
            }
          }
          if (!taskId) return undefined;

          await imageGenerationService.createChatImageTask({
            model,
            params: { ...baseParams, prompt: item.prompt },
            provider,
            taskId,
          });
          if (!invocationIsCurrent()) return undefined;

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
          // clear the (possibly expiring) previewUrl so the UI never shows a
          // soon-to-be-broken image, and record the failure for this index
          await get().updateImageItem(messageId, (draft) => {
            if (draft[index]) draft[index].previewUrl = undefined;
          });
          return { error, index };
        } finally {
          inFlightTaskKeys.delete(loadingKey);
          get().toggleDallEImageLoading(loadingKey, false);
        }
      },
      { concurrency: 3 },
    );

    if (!invocationIsCurrent()) return;

    // set plugin error ONCE, after all items settle, to avoid the concurrent
    // read-modify-write race the previous shared-array approach had
    const failures = results.filter((r): r is { error: unknown; index: number } => r !== undefined);
    if (failures.length > 0) {
      const errorArray: unknown[] = [];
      for (const f of failures) errorArray[f.index] = serializePluginError(f.error);
      await get().updatePluginState(messageId, { error: errorArray });
    }
  },
  reconcileDallETasks: async (messageId) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;

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
        if (inFlightTaskKeys.has(loadingKey)) return;
        inFlightTaskKeys.add(loadingKey);
        get().toggleDallEImageLoading(loadingKey, true);

        try {
          const { ok, file } = await waitForChatImageTask(item.taskId, invocationIsCurrent, {
            immediate: true,
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
          inFlightTaskKeys.delete(loadingKey);
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
