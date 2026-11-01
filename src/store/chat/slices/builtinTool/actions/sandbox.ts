import { produce } from 'immer';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { fileService } from '@/services/file';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatStore } from '@/store/chat/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { setNamespace } from '@/utils/storeDebug';

import { serializePluginError } from './helpers';

const n = setNamespace('sandbox');

const SWR_FETCH_SANDBOX_FILE_KEY = 'FetchSandboxFileItem';

/** Conversation the in-tab call started in, when the tool row is no longer on the active map. */
export interface SandboxInvocationScope {
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}

export interface ChatSandboxAction {
  /** Runs one Sandbox tool API on the server and stores its result on the tool message. */
  invokeSandboxTool: (
    id: string,
    apiName: string,
    params: Record<string, unknown>,
    /** Sandbox Hub profile tool identifier; omitted means `lobe-sandbox`. */
    identifier?: string,
    /** Used when the tool message is not in the active topic map. */
    scope?: SandboxInvocationScope,
  ) => Promise<{
    data: unknown;
    outcome: 'cancelled' | 'completed' | 'failed';
    shouldContinue: boolean;
  }>;
  toggleSandboxExecuting: (id: string, executing: boolean) => void;
  useFetchSandboxFileItem: (id?: string) => SWRResponse;
}

export const sandboxSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatSandboxAction
> = (set, get) => ({
  invokeSandboxTool: async (id, apiName, params, identifier, scope) => {
    const invocationGeneration = get().conversationClearGeneration;
    const invocationIsCurrent = () => get().conversationClearGeneration === invocationGeneration;

    get().toggleSandboxExecuting(id, true);

    try {
      const message = chatSelectors.getMessageById(id)(get());
      if (!invocationIsCurrent()) {
        return { data: undefined, outcome: 'cancelled', shouldContinue: false };
      }

      const conversation = message
        ? {
            groupId: message.groupId,
            sessionId: message.sessionId ?? get().activeId,
            threadId: message.threadId ?? get().activeThreadId,
            topicId: message.topicId ?? get().activeTopicId,
          }
        : scope
          ? {
              groupId: scope.groupId,
              sessionId: scope.sessionId,
              threadId: scope.threadId,
              topicId: scope.topicId,
            }
          : {
              groupId: undefined,
              sessionId: get().activeId,
              threadId: get().activeThreadId,
              topicId: get().activeTopicId,
            };

      const result = await lambdaClient.sandbox.invoke.mutate({
        apiName,
        arguments: params,
        groupId: conversation.groupId,
        ...(identifier ? { identifier } : {}),
        sessionId: conversation.sessionId,
        threadId: conversation.threadId,
        topicId: conversation.topicId,
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
        get().toggleSandboxExecuting(id, false);
      }
    }
  },

  toggleSandboxExecuting: (id: string, executing: boolean) => {
    set(
      { sandboxExecuting: { ...get().sandboxExecuting, [id]: executing } },
      false,
      n('toggleSandboxExecuting'),
    );
  },

  useFetchSandboxFileItem: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR(
      id && requestedScope ? [SWR_FETCH_SANDBOX_FILE_KEY, requestedScope, id] : null,
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
            if (draft.sandboxFileMap[id]) return;

            draft.sandboxFileMap[id] = item;
          }),
          false,
          n('useFetchSandboxFileItem'),
        );

        return item;
      },
    );
  },
});
