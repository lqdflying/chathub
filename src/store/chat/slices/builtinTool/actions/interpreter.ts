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
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;

    get().toggleInterpreterExecuting(id, true);

    try {
      // Gather any files the conversation produced so the code can read them.
      // Done INSIDE the try so a failed fetch / malformed content can't leave the
      // executing flag stuck; individual failures are skipped, not fatal.
      // TODO: only load the files the AI actually references.
      const files: File[] = [];
      const pushFromUrl = async (url: string, name: string) => {
        try {
          const blob = await fetch(url).then((res) => res.blob());
          files.push(new File([blob], name));
        } catch {
          // skip a file that can't be fetched
        }
      };
      for (const message of chatSelectors.mainDisplayChats(get())) {
        for (const file of message.fileList ?? []) await pushFromUrl(file.url, file.name);
        for (const image of message.imageList ?? []) await pushFromUrl(image.url, image.alt);
        for (const tool of message.tools ?? []) {
          if (tool.identifier !== CodeInterpreterIdentifier) continue;
          const toolMessage = chatSelectors.getMessageByToolCallId(tool.id)(get());
          if (!toolMessage?.content) continue;
          try {
            const content = JSON.parse(toolMessage.content) as CodeInterpreterResponse;
            for (const file of content.files ?? []) {
              if (!file.fileId) continue;
              const item = await fileService.getFile(file.fileId);
              await pushFromUrl(item.url, file.filename);
            }
          } catch {
            // skip a tool message with malformed content
          }
        }
      }

      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      const result = await pythonService.runPython(params.code, params.packages, files);
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      if (result?.files) {
        // don't persist the raw File objects (they serialize to `{}`); keep the
        // blob previewUrl only for this session's immediate display, then
        // uploadInterpreterFiles swaps in a durable fileId
        const persistable = {
          ...result,
          files: result.files.map((file) => ({ ...file, data: undefined })),
        };
        await get().internal_updateMessageContent(id, JSON.stringify(persistable));
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
      expectedGeneration === undefined || get().conversationClearGeneration === expectedGeneration;

    await pMap(files, async (file, index) => {
      if (!file.data || !invocationIsCurrent()) return;

      try {
        const uploadResult = await useFileStore.getState().uploadWithProgress({
          file: file.data,
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
        // clear the dead blob previewUrl so a reload doesn't show a broken image
        if (invocationIsCurrent()) {
          await get().updateInterpreterFileItem(id, (draft) => {
            if (draft.files?.[index]) draft.files[index].previewUrl = undefined;
          });
        }
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
