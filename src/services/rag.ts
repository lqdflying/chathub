import type {
  KnowledgeBaseClientPreparationFailurePhase,
  KnowledgeBasePromptTokenCountMode,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { SemanticSearchSchemaType } from '@/types/rag';

class RAGService {
  parseFileContent = async (id: string, skipExist?: boolean) => {
    return lambdaClient.document.parseFileContent.mutate({ id, skipExist });
  };

  createParseFileTask = async (id: string, skipExist?: boolean) => {
    return lambdaClient.chunk.createParseFileTask.mutate({ id, skipExist });
  };

  retryParseFile = async (id: string) => {
    return lambdaClient.chunk.retryParseFileTask.mutate({ id });
  };

  createEmbeddingChunksTask = async (id: string) => {
    return lambdaClient.chunk.createEmbeddingChunksTask.mutate({ id });
  };

  semanticSearch = async (query: string, fileIds?: string[]) => {
    return lambdaClient.chunk.semanticSearch.mutate({ fileIds, query });
  };

  semanticSearchForChat = async (params: SemanticSearchSchemaType) => {
    return lambdaClient.chunk.semanticSearchForChat.mutate(params);
  };

  reportKnowledgeClientEvent = async (params: {
    chunkCount?: number;
    countMode?: KnowledgeBasePromptTokenCountMode;
    diagnosticId?: string;
    event: 'client_preparation_failed' | 'prompt_injection_reported';
    failurePhase?: KnowledgeBaseClientPreparationFailurePhase;
    promptTokens?: number;
    queryRewritten?: boolean;
  }) => lambdaClient.chunk.reportKnowledgeClientEvent.mutate(params);

  deleteMessageRagQuery = async (id: string) => {
    return lambdaClient.message.removeMessageQuery.mutate({ id });
  };
}

export const ragService = new RAGService();
