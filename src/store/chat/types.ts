export interface ConversationContext {
  generation: number;
  sessionId: string;
  topicId?: string | null;
}

export interface TitleSummaryOperation {
  abortController: AbortController;
  containerId: string;
  displayedTitle: string;
  operationId: string;
  originalTitle: string;
}
