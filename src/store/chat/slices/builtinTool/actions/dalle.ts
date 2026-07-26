import { produce } from 'immer';
import pMap from 'p-map';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { imageGenerationService } from '@/services/textToImage';
import { uploadService } from '@/services/upload';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { DallEImageItem } from '@/types/tool/dalle';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('tool');

const SWR_FETCH_KEY = 'FetchImageItem';

export interface ChatDallEAction {
  generateImageFromPrompts: (items: DallEImageItem[], id: string) => Promise<void>;
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
    const invocationIsCurrent = () =>
      get().conversationClearGeneration === invocationGeneration;

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const getMessageById = (id: string) => chatSelectors.getMessageById(id)(get());

    const message = getMessageById(messageId);
    if (!message) return;

    const parent = getMessageById(message!.parentId!);
    const originPrompt = parent?.content;
    let errorArray: any[] = [];

    await pMap(items, async (params, index) => {
      if (!invocationIsCurrent()) return;

      get().toggleDallEImageLoading(messageId + params.prompt, true);

      let url = '';
      try {
        url = await imageGenerationService.generateImage(params);
      } catch (e) {
        if (!invocationIsCurrent()) return;

        get().toggleDallEImageLoading(messageId + params.prompt, false);
        errorArray[index] = e;

        await get().updatePluginState(messageId, { error: errorArray });
      }
      if (!invocationIsCurrent()) return;

      if (!url) return;

      await get().updateImageItem(messageId, (draft) => {
        draft[index].previewUrl = url;
      });
      if (!invocationIsCurrent()) return;

      get().toggleDallEImageLoading(messageId + params.prompt, false);
      const imageFile = await uploadService.getImageFileByUrlWithCORS(
        url,
        `${originPrompt || params.prompt}_${index}.png`,
      );
      if (!invocationIsCurrent()) return;

      const data = await useFileStore.getState().uploadWithProgress({
        file: imageFile,
      });
      if (!invocationIsCurrent()) return;

      if (!data) return;

      await get().updateImageItem(messageId, (draft) => {
        draft[index].imageId = data.id;
        draft[index].previewUrl = undefined;
      });
    });
  },
  text2image: async (id, data) => {
    // const isAutoGen = settingsSelectors.isDalleAutoGenerating(useGlobalStore.getState());
    // if (!isAutoGen) return;

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
