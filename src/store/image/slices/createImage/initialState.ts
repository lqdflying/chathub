export interface CreateImageState {
  imageGenerationAbortControllers: AbortController[];
  isCreating: boolean;
  regeneratingBatchIds: string[];
}

export const initialCreateImageState: CreateImageState = {
  imageGenerationAbortControllers: [],
  isCreating: false,
  regeneratingBatchIds: [],
};
