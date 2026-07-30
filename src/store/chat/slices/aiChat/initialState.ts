import type { ChatInputEditor } from '@/features/ChatInput';

export interface MainSendMessageOperation {
  abortController?: AbortController | null;
  inputEditorTempState?: any | null;
  inputSendErrorMsg?: string;
  isLoading: boolean;
}

export interface PreSendCompactionOperation {
  abortController: AbortController;
  threadId?: string | null;
}

export interface ChatAIChatState {
  /**
   * is the AI message is generating
   */
  chatLoadingIds: string[];
  chatLoadingIdsAbortController?: AbortController;
  inputFiles: File[];
  inputMessage: string;
  mainInputEditor: ChatInputEditor | null;
  /**
   * sendMessageInServer operations map, keyed by sessionId|topicId
   * Contains both loading state and AbortController
   */
  mainSendMessageOperations: Record<string, MainSendMessageOperation>;
  messageInToolsCallingIds: string[];
  messageInToolsCallingIdsAbortController?: AbortController;
  /**
   * is the message is in RAG flow
   */
  messageRAGLoadingIds: string[];
  /** User-message anchors currently being rewound and regenerated. */
  messageRetryingIds: string[];
  pluginApiAbortControllers: Record<string, AbortController>;
  pluginApiLoadingIds: string[];
  /**
   * pre-send token-threshold compaction operations, keyed by sessionId|topicId.
   * Registered by sendMessage/sendMessageInServer while compaction runs so
   * stopGenerateMessage can abort it for the current conversation only.
   */
  preSendCompactionOperations: Record<string, PreSendCompactionOperation>;
  /**
   * is the AI message is reasoning
   */
  reasoningLoadingIds: string[];
  reasoningLoadingIdsAbortController?: AbortController;
  searchWorkflowLoadingIds: string[];
  searchWorkflowLoadingIdsAbortController?: AbortController;
  threadInputEditor: ChatInputEditor | null;
  /**
   * the tool calling stream ids
   */
  toolCallingStreamIds: Record<string, boolean[]>;
}

export const initialAiChatState: ChatAIChatState = {
  chatLoadingIds: [],
  inputFiles: [],
  inputMessage: '',
  mainInputEditor: null,
  mainSendMessageOperations: {},
  messageInToolsCallingIds: [],
  messageRAGLoadingIds: [],
  messageRetryingIds: [],
  pluginApiAbortControllers: {},
  pluginApiLoadingIds: [],
  preSendCompactionOperations: {},
  reasoningLoadingIds: [],
  searchWorkflowLoadingIds: [],
  threadInputEditor: null,
  toolCallingStreamIds: {},
};
