export interface ConversationContext {
  clearGeneration: number;
  generation: number;
  sessionId: string;
  topicId?: string | null;
}

export interface TitleSummaryOperation {
  abortController: AbortController;
  containerId: string;
  displayedTitle: string;
  loadingOperationKey: string;
  operationId: string;
  originalTitle: string;
}
