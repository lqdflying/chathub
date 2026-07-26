import { AIModelsState, initialAIModelState } from './slices/aiModel';
import { AIProviderState, initialAIProviderState } from './slices/aiProvider';

export interface AIProviderStoreState extends AIProviderState, AIModelsState {
  scopeGeneration: number;
}

export const initialState: AIProviderStoreState = {
  ...initialAIProviderState,
  ...initialAIModelState,
  scopeGeneration: 0,
};
