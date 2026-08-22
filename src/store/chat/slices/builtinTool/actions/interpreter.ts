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
import { lambdaClient } from '@/libs/trpc/client';
import { fileService } from '@/services/file';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { setNamespace } from '@/utils/storeDebug';

import { serializePluginError } from './helpers';

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
      const message = chatSelectors.getMessageById(id)(get());
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      const result = await lambdaClient.codeInterpreter.run.mutate({
        code: params.code,
        groupId: message?.groupId,
        packages: params.packages,
        sessionId: message?.sessionId ?? get().activeId,
        threadId: message?.threadId ?? get().activeThreadId,
        topicId: message?.topicId ?? get().activeTopicId,
      });
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      await get().internal_updateMessageContent(id, JSON.stringify(result));
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
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

      const serializedError = serializePluginError(error);
      await get().updatePluginState(id, { error: serializedError });

      return {
        data: serializedError,
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
