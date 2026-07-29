export interface CreateImageState {
  imageGenerationAbortControllers: AbortController[];
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
  regeneratingBatchIds: string[];
}

export const initialCreateImageState: CreateImageState = {
  imageGenerationAbortControllers: [],
  isCreating: false,
  isCreatingWithNewTopic: false,
  regeneratingBatchIds: [],
};
