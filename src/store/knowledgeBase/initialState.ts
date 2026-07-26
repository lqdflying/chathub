import { KnowledgeBaseState, initialKnowledgeBaseState } from '../knowledgeBase/slices/crud';
import { RAGEvalState, initialDatasetState } from '../knowledgeBase/slices/ragEval';

export interface KnowledgeBaseScopeState {
  scopeGeneration: number;
}

export type KnowledgeBaseStoreState = KnowledgeBaseState & RAGEvalState & KnowledgeBaseScopeState;

export const initialState: KnowledgeBaseStoreState = {
  scopeGeneration: 0,
  ...initialKnowledgeBaseState,
  ...initialDatasetState,
};
