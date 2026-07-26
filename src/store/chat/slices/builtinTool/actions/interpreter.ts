import {
  CodeInterpreterFileItem,
  CodeInterpreterParams,
  CodeInterpreterResponse,
} from '@lobechat/types';
import { produce } from 'immer';
import pMap from 'p-map';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { pythonService } from '@/services/python';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('codeInterpreter');

const SWR_FETCH_INTERPRETER_FILE_KEY = 'FetchCodeInterpreterFileItem';

export interface ChatCodeInterpreterAction {
  python: (
    id: string,
    params: CodeInterpreterParams,
  ) => Promise<{
    data: unknown;
    outcome: 'cancelled' | 'completed' | 'failed';
    shouldContinue: boolean;
  }>;
  toggleInterpreterExecuting: (id: string, loading: boolean) => void;
  updateInterpreterFileItem: (
    id: string,
    updater: (data: CodeInterpreterResponse) => void,
  ) => Promise<void>;
  uploadInterpreterFiles: (
    id: string,
    files: CodeInterpreterFileItem[],
    expectedGeneration?: number,
  ) => Promise<void>;
  useFetchInterpreterFileItem: (id?: string) => SWRResponse;
}

export const codeInterpreterSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatCodeInterpreterAction
> = (set, get) => ({
  python: async (id: string, params: CodeInterpreterParams) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () =>
      get().conversationClearGeneration === invocationGeneration;

    get().toggleInterpreterExecuting(id, true);

    // TODO: 应该只下载 AI 用到的文件
    const files: File[] = [];
    for (const message of chatSelectors.mainDisplayChats(get())) {
      for (const file of message.fileList ?? []) {
        const blob = await fetch(file.url).then((res) => res.blob());
        files.push(new File([blob], file.name));
      }
      for (const image of message.imageList ?? []) {
        const blob = await fetch(image.url).then((res) => res.blob());
        files.push(new File([blob], image.alt));
      }
      for (const tool of message.tools ?? []) {
        if (tool.identifier === CodeInterpreterIdentifier) {
          const message = chatSelectors.getMessageByToolCallId(tool.id)(get());
          if (message?.content) {
            const content = JSON.parse(message.content) as CodeInterpreterResponse;
            for (const file of content.files ?? []) {
              const item = await fileService.getFile(file.fileId!);
              const blob = await fetch(item.url).then((res) => res.blob());
              files.push(new File([blob], file.filename));
            }
          }
        }
      }
    }

    try {
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      const result = await pythonService.runPython(params.code, params.packages, files);
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      if (result?.files) {
        await get().internal_updateMessageContent(id, JSON.stringify(result));
        if (!invocationIsCurrent()) {
          return { data: undefined, outcome: 'cancelled', shouldContinue: false };
        }

        await get().uploadInterpreterFiles(id, result.files, invocationGeneration);
        if (!invocationIsCurrent()) {
          return { data: undefined, outcome: 'cancelled', shouldContinue: false };
        }
      } else {
        await get().internal_updateMessageContent(id, JSON.stringify(result));
        if (!invocationIsCurrent()) {
          return { data: undefined, outcome: 'cancelled', shouldContinue: false };
        }
      }

      return {
        data: result,
        outcome: 'completed',
        shouldContinue: true,
      };
    } catch (error) {
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      await get().updatePluginState(id, { error });

      return {
        data: error,
        outcome: 'failed',
        shouldContinue: false,
      };
    } finally {
      if (invocationIsCurrent()) {
        get().toggleInterpreterExecuting(id, false);
      }
    }
  },

  toggleInterpreterExecuting: (id: string, executing: boolean) => {
    set(
      { codeInterpreterExecuting: { ...get().codeInterpreterExecuting, [id]: executing } },
      false,
      n('toggleInterpreterExecuting'),
    );
  },

  updateInterpreterFileItem: async (
    id: string,
    updater: (data: CodeInterpreterResponse) => void,
  ) => {
    const message = chatSelectors.getMessageById(id)(get());
    if (!message) return;

    const result: CodeInterpreterResponse = JSON.parse(message.content);
    if (!result.files) return;

    const nextResult = produce(result, updater);

    await get().internal_updateMessageContent(id, JSON.stringify(nextResult));
  },

  uploadInterpreterFiles: async (id, files, expectedGeneration) => {
    if (!files) return;
    const invocationIsCurrent = () =>
      expectedGeneration === undefined ||
      get().conversationClearGeneration === expectedGeneration;

    await pMap(files, async (file, index) => {
      if (!file.data || !invocationIsCurrent()) return;

      try {
        const uploadResult = await useFileStore.getState().uploadWithProgress({
          file: file.data,
          skipCheckFileType: true,
        });
        if (!invocationIsCurrent()) return;

        if (uploadResult?.id) {
          await get().updateInterpreterFileItem(id, (draft) => {
            if (draft.files?.[index]) {
              draft.files[index].fileId = uploadResult.id;
              draft.files[index].previewUrl = undefined;
              draft.files[index].data = undefined;
            }
          });
        }
      } catch (error) {
        console.error('Failed to upload CodeInterpreter file:', error);
      }
    });
  },

  useFetchInterpreterFileItem: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR(
      id && requestedScope ? [SWR_FETCH_INTERPRETER_FILE_KEY, requestedScope, id] : null,
      async () => {
        if (!id || !requestedScope) return null;
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
            if (draft.codeInterpreterImageMap[id]) return;

            draft.codeInterpreterImageMap[id] = item;
          }),
          false,
          n('useFetchInterpreterFileItem'),
        );

        return item;
      },
    );
  },
});
