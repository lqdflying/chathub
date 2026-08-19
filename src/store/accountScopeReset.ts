import { clearAccountCache } from '@/libs/swr/accountCache';
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
import { useImageStore } from '@/store/image';
import { initialState as initialImageState } from '@/store/image/initialState';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';
import { initialState as initialKnowledgeBaseState } from '@/store/knowledgeBase/initialState';
import { useSessionStore } from '@/store/session';
import { initialState as initialSessionState } from '@/store/session/initialState';
import { useSkillStore } from '@/store/skill';
import { initialState as initialSkillState } from '@/store/skill/initialState';
import { useToolStore } from '@/store/tool';
import { initialState as initialToolState } from '@/store/tool/initialState';
import { useUserStore } from '@/store/user';

const abortControllers = (
  abortControllerList: Array<AbortController | null | undefined>,
  reason: string,
): void => {
  for (const abortController of abortControllerList) {
    abortController?.abort(reason);
  }
};

export const resetAccountScopedStores = (reason: string): void => {
  void clearAccountCache();

  const userState = useUserStore.getState();
  abortControllers(
    [userState.updateSettingsSignal, ...userState.userMutationAbortControllers],
    reason,
  );
  useUserStore.setState({
    updateSettingsSignal: undefined,
    userMutationAbortControllers: [],
  });

  const sessionState = useSessionStore.getState();
  sessionState.signalSessionMeta?.abort(reason);
  useSessionStore.setState({
    ...initialSessionState,
    scopeGeneration: sessionState.scopeGeneration + 1,
  });

  const chatState = useChatStore.getState();
  abortControllers(
    [
      chatState.chatLoadingIdsAbortController,
      chatState.messageInToolsCallingIdsAbortController,
      chatState.reasoningLoadingIdsAbortController,
      chatState.searchWorkflowLoadingIdsAbortController,
      ...Object.values(chatState.mainSendMessageOperations).map(
        (operation) => operation.abortController,
      ),
      ...Object.values(chatState.pluginApiAbortControllers),
      ...Object.values(chatState.supervisorDecisionAbortControllers),
      ...Object.values(chatState.threadTitleSummaryOperations).map(
        (operation) => operation.abortController,
      ),
      ...Object.values(chatState.topicTitleSummaryOperations).map(
        (operation) => operation.abortController,
      ),
    ],
    reason,
  );
  for (const debounceTimer of Object.values(chatState.supervisorDebounceTimers)) {
    window.clearTimeout(debounceTimer);
  }
  useChatStore.setState({
    ...initialChatState,
    conversationClearGeneration: chatState.conversationClearGeneration + 1,
    conversationNavigationGeneration: chatState.conversationNavigationGeneration + 1,
    conversationScopedClearGenerations: {},
  });

  const imageState = useImageStore.getState();
  abortControllers(imageState.imageGenerationAbortControllers, reason);
  useImageStore.setState({
    ...initialImageState,
    scopeGeneration: imageState.scopeGeneration + 1,
  });

  const agentState = useAgentStore.getState();
  abortControllers(
    [agentState.updateAgentChatConfigSignal, agentState.updateAgentConfigSignal],
    reason,
  );
  useAgentStore.setState({
    ...initialAgentState,
    scopeGeneration: agentState.scopeGeneration + 1,
  });

  const chatGroupState = useChatGroupStore.getState();
  useChatGroupStore.setState({
    ...initialChatGroupState,
    scopeGeneration: chatGroupState.scopeGeneration + 1,
  });

  const aiInfraState = useAiInfraStore.getState();
  useAiInfraStore.setState({
    ...initialAiInfraState,
    scopeGeneration: aiInfraState.scopeGeneration + 1,
  });

  const fileState = useFileStore.getState();
  fileState.abortFileUploads();
  for (const fileItem of [...fileState.chatUploadFileList, ...fileState.dockUploadFileList]) {
    if (fileItem.previewUrl) URL.revokeObjectURL(fileItem.previewUrl);
  }
  useFileStore.setState({
    ...initialFileState,
    scopeGeneration: fileState.scopeGeneration + 1,
  });

  const knowledgeBaseState = useKnowledgeBaseStore.getState();
  useKnowledgeBaseStore.setState({
    ...initialKnowledgeBaseState,
    scopeGeneration: knowledgeBaseState.scopeGeneration + 1,
  });

  useSkillStore.setState(initialSkillState);

  const toolState = useToolStore.getState();
  toolState.updatePluginSettingsSignal?.abort(reason);
  abortControllers(
    [
      ...Object.values(toolState.mcpInstallAbortControllers),
      ...Object.values(toolState.mcpTestAbortControllers),
    ],
    reason,
  );
  useToolStore.setState({
    ...initialToolState,
    scopeGeneration: toolState.scopeGeneration + 1,
  });
};
