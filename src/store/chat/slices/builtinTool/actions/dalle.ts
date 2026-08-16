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

// A poll error is only worth retrying when it is transient (mangled transport
// response or a 5xx). Schema/auth/permanent tRPC failures must surface at once
// instead of being retried silently for the whole five-minute budget.
const isTransientPollError = (error: unknown) => {
  if (findRPCResponseError(error)) return true;
  const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
  return typeof status === 'number' && status >= 500;
};

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
        { name: error?.name ?? 'ImageGenerationError' },
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
          let taskId = item.taskId;

          // an item may already carry a task from a previous session/attempt:
          // adopt its result (or resume waiting) BEFORE creating a new billable
          // generation — Retry must never re-bill a task that succeeded
          if (taskId) {
            try {
              const adopted = await waitForChatImageTask(taskId, invocationIsCurrent, {
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
            } catch {
              // the previous task genuinely failed/expired — fall through and
              // create a fresh one
              taskId = undefined;
            }
          }

          const created = await imageGenerationService.createChatImageTask({
            model,
            params: { ...baseParams, prompt: item.prompt },
            provider,
          });
          taskId = created.taskId;
          if (!invocationIsCurrent()) return undefined;

          // persist the correlation IMMEDIATELY — a reload/navigation must be
          // able to find and adopt this task instead of orphaning it
          await get().updateImageItem(messageId, (draft) => {
            if (draft[index]) draft[index].taskId = taskId;
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
    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    const data: DallEImageItem[] = JSON.parse(message.content);

    const nextContent = produce(data, updater);
    await get().internal_updateMessageContent(id, JSON.stringify(nextContent));
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
