'use client';

import { useRouter } from 'next/navigation';
import { memo, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import { enableNextAuth } from '@/const/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { initialState as initialAgentState } from '@/store/agent/initialState';
import { useAiInfraStore } from '@/store/aiInfra';
import { initialState as initialAiInfraState } from '@/store/aiInfra/initialState';
import { useChatStore } from '@/store/chat';
import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatGroupStore } from '@/store/chatGroup';
import { initialChatGroupState } from '@/store/chatGroup/initialState';
import { useFileStore } from '@/store/file';
import { initialState as initialFileState } from '@/store/file/initialState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import { initialState as initialImageState } from '@/store/image/initialState';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';
import { initialState as initialKnowledgeBaseState } from '@/store/knowledgeBase/initialState';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useSessionStore } from '@/store/session';
import { initialState as initialSessionState } from '@/store/session/initialState';
import { useToolStore } from '@/store/tool';
import { initialState as initialToolState } from '@/store/tool/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const StoreInitialization = memo(() => {
  // prefetch error ns to avoid don't show error content correctly
  useTranslation('error');

  const router = useRouter();
  const [currentUserScope, isLogin, isSignedIn, useInitUserState] = useUserStore((s) => [
    authSelectors.currentUserScope(s),
    authSelectors.isLogin(s),
    s.isSignedIn,
    s.useInitUserState,
  ]);
  const previousUserScopeRef = useRef(currentUserScope);

  const { serverConfig } = useServerConfigStore();

  const useInitSystemStatus = useGlobalStore((s) => s.useInitSystemStatus);

  const useInitAgentStore = useAgentStore((s) => s.useInitInboxAgentStore);
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);

  // init the system preference
  useInitSystemStatus();

  // fetch server config
  const useFetchServerConfig = useServerConfigStore((s) => s.useInitServerConfig);
  useFetchServerConfig();

  // Update NextAuth status
  const useUserStoreUpdater = createStoreUpdater(useUserStore);
  const oAuthSSOProviders = useServerConfigStore(serverConfigSelectors.oAuthSSOProviders);
  useUserStoreUpdater('oAuthSSOProviders', oAuthSSOProviders);

  /**
   * The store function of `isLogin` will both consider the values of `enableAuth` and `isSignedIn`.
   * But during initialization, the value of `enableAuth` might be incorrect cause of the async fetch.
   * So we need to use `isSignedIn` only to determine whether request for the default agent config and user state.
   *
   * IMPORTANT: Explicitly convert to boolean to avoid passing null/undefined downstream,
   * which would cause unnecessary API requests with invalid login state.
   */
  const isDBInited = useGlobalStore(systemStatusSelectors.isDBInited);
  const isLoginOnInit = isDBInited ? Boolean(enableNextAuth ? isSignedIn : isLogin) : false;
  const userStateScope = isLoginOnInit ? currentUserScope : undefined;

  useLayoutEffect(() => {
    if (previousUserScopeRef.current === currentUserScope) return;
    previousUserScopeRef.current = currentUserScope;

    const chatState = useChatStore.getState();
    chatState.chatLoadingIdsAbortController?.abort();
    chatState.messageInToolsCallingIdsAbortController?.abort();
    chatState.reasoningLoadingIdsAbortController?.abort();
    chatState.searchWorkflowLoadingIdsAbortController?.abort();
    Object.values(chatState.mainSendMessageOperations).forEach((operation) => {
      operation.abortController?.abort();
    });
    Object.values(chatState.pluginApiAbortControllers).forEach((controller) => {
      controller.abort();
    });
    Object.values(chatState.supervisorDecisionAbortControllers).forEach((controller) => {
      controller.abort();
    });
    Object.values(chatState.supervisorDebounceTimers).forEach((timer) => {
      window.clearTimeout(timer);
    });

    const sessionState = useSessionStore.getState();
    sessionState.signalSessionMeta?.abort();

    const agentState = useAgentStore.getState();
    agentState.updateAgentChatConfigSignal?.abort();
    agentState.updateAgentConfigSignal?.abort();

    const fileState = useFileStore.getState();
    fileState.abortFileUploads();
    [...fileState.chatUploadFileList, ...fileState.dockUploadFileList].forEach((fileItem) => {
      if (fileItem.previewUrl) URL.revokeObjectURL(fileItem.previewUrl);
    });

    const knowledgeBaseState = useKnowledgeBaseStore.getState();

    const toolState = useToolStore.getState();
    toolState.updatePluginSettingsSignal?.abort();
    Object.values(toolState.mcpInstallAbortControllers).forEach((controller) => controller.abort());
    Object.values(toolState.mcpTestAbortControllers).forEach((controller) => controller.abort());

    useSessionStore.setState(
      {
        ...initialSessionState,
        scopeGeneration: sessionState.scopeGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    useChatStore.setState(
      {
        ...initialChatState,
        conversationClearGeneration: chatState.conversationClearGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    useImageStore.setState(
      {
        ...initialImageState,
        scopeGeneration: useImageStore.getState().scopeGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    useAgentStore.setState(
      {
        ...initialAgentState,
        scopeGeneration: agentState.scopeGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    const chatGroupState = useChatGroupStore.getState();
    useChatGroupStore.setState(
      {
        ...initialChatGroupState,
        scopeGeneration: chatGroupState.scopeGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    const aiInfraState = useAiInfraStore.getState();
    useAiInfraStore.setState(
      {
        ...initialAiInfraState,
        scopeGeneration: aiInfraState.scopeGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    useFileStore.setState(
      { ...initialFileState, scopeGeneration: fileState.scopeGeneration + 1 },
      false,
      'resetAccountScope',
    );
    useKnowledgeBaseStore.setState(
      {
        ...initialKnowledgeBaseState,
        scopeGeneration: knowledgeBaseState.scopeGeneration + 1,
      },
      false,
      'resetAccountScope',
    );
    useToolStore.setState(
      { ...initialToolState, scopeGeneration: toolState.scopeGeneration + 1 },
      false,
      'resetAccountScope',
    );
  }, [currentUserScope]);

  // init inbox agent and default agent config
  useInitAgentStore(isLoginOnInit, userStateScope, serverConfig.defaultAgent?.config);

  // init user provider key vaults
  useInitAiProviderKeyVaults(isLoginOnInit, userStateScope);

  // init user state
  useInitUserState(isLoginOnInit, userStateScope, serverConfig, {
    onSuccess: (state) => {
      if (state.isOnboard === false) {
        router.push('/onboard');
      }
    },
  });

  const useStoreUpdater = createStoreUpdater(useGlobalStore);

  const mobile = useIsMobile();

  useStoreUpdater('isMobile', mobile);
  useStoreUpdater('router', router);

  return null;
});

export default StoreInitialization;
