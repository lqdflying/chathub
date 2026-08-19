import type { ChatInputEditor } from '@/features/ChatInput';

import type {
  ConversationLaneStopMarker,
  DurableInFlightEnqueue,
} from '../../utils/conversationClearGeneration';

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
  /** Per-lane abort controllers so thread Stop does not abort main generation. */
  chatLoadingAbortControllersByLane: Record<string, AbortController>;
  /**
   * is the AI message is generating
   */
  chatLoadingIds: string[];
  chatLoadingIdsAbortController?: AbortController;
  /** Maps assistant message ids to durable conversation lane keys for scoped Stop. */
  chatLoadingLaneByMessageId: Record<string, string>;
  /** Lane/topic keys marked stopped until a replacement durable operation supersedes them. */
  conversationLaneStopMarkers: Record<string, ConversationLaneStopMarker>;
  /**
   * Durable enqueue requests currently in flight, keyed by client lane key. Stop
   * promotes matching entries into the lane stop marker so an operation that only
   * becomes visible to the server after the Stop snapshot is still fenced; the
   * entry kind keeps chat Stop from fencing unrelated title/translation/compaction
   * enqueues.
   */
  durableInFlightEnqueues: Record<string, DurableInFlightEnqueue[]>;
  inputFiles: File[];
  inputMessage: string;
  /** RAG prompt tokens currently carried by an in-flight provider request. */
  knowledgeBaseContextTokens: Record<string, number>;
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
  chatLoadingAbortControllersByLane: {},
  chatLoadingIds: [],
  chatLoadingLaneByMessageId: {},
  conversationLaneStopMarkers: {},
  durableInFlightEnqueues: {},
  inputFiles: [],
  inputMessage: '',
  knowledgeBaseContextTokens: {},
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
