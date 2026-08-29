import { lambdaClient } from '@/libs/trpc/client';

class AgentService {
  createAgentKnowledgeBase = async (
    agentId: string,
    knowledgeBaseId: string,
    enabled?: boolean,
  ) => {
    return lambdaClient.agent.createAgentKnowledgeBase.mutate({
      agentId,
      enabled,
      knowledgeBaseId,
    });
  };

  deleteAgentKnowledgeBase = async (agentId: string, knowledgeBaseId: string) => {
    return lambdaClient.agent.deleteAgentKnowledgeBase.mutate({ agentId, knowledgeBaseId });
  };

  toggleKnowledgeBase = async (agentId: string, knowledgeBaseId: string, enabled?: boolean) => {
    return lambdaClient.agent.toggleKnowledgeBase.mutate({
      agentId,
      enabled,
      knowledgeBaseId,
    });
  };

  createAgentFiles = async (agentId: string, fileIds: string[], enabled?: boolean) => {
    return lambdaClient.agent.createAgentFiles.mutate({ agentId, enabled, fileIds });
  };

  deleteAgentFile = async (agentId: string, fileId: string) => {
    return lambdaClient.agent.deleteAgentFile.mutate({ agentId, fileId });
  };

  toggleFile = async (agentId: string, fileId: string, enabled?: boolean) => {
    return lambdaClient.agent.toggleFile.mutate({
      agentId,
      enabled,
      fileId,
    });
  };

  getFilesAndKnowledgeBases = async (agentId: string) => {
    return lambdaClient.agent.getKnowledgeBasesAndFiles.query({ agentId });
  };

  regenerateDreamMemory = async (input: {
    agentId: string;
    historyDate: string;
    index: number;
    match: string;
  }) => {
    return lambdaClient.agent.regenerateDreamMemory.mutate(input);
  };

  updateDreamMemoryCard = async (input: {
    agentId: string;
    body: string;
    dateTag: string;
    index: number;
    match: string;
  }) => {
    return lambdaClient.agent.updateDreamMemoryCard.mutate(input);
  };

  deleteDreamMemoryCard = async (input: {
    agentId: string;
    dateTag: string;
    index: number;
    match: string;
  }) => {
    return lambdaClient.agent.deleteDreamMemoryCard.mutate(input);
  };

  clearDreamMemory = async (input: { agentId: string }) => {
    return lambdaClient.agent.clearDreamMemory.mutate(input);
  };

  applyDreamMemoryRetention = async (input: { agentId: string; maxEntries: number }) => {
    return lambdaClient.agent.applyDreamMemoryRetention.mutate(input);
  };
}

export const agentService = new AgentService();
