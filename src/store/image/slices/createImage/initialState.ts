export interface CreateImageState {
  imageGenerationAbortControllers: AbortController[];
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
}

export const initialCreateImageState: CreateImageState = {
  imageGenerationAbortControllers: [],
  isCreating: false,
  isCreatingWithNewTopic: false,
};
