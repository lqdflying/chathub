import { INBOX_SESSION_ID } from '@/const/session';
import { lambdaClient } from '@/libs/trpc/client';
import { ITopicService } from '@/services/topic/type';

export class ServerService implements ITopicService {
  createTopic: ITopicService['createTopic'] = (params, options) =>
    lambdaClient.topic.createTopic.mutate({
      ...params,
      expectedConversationVersion: options?.expectedConversationVersion,
      sessionId: this.toDbSessionId(params.sessionId),
    });

  batchCreateTopics: ITopicService['batchCreateTopics'] = (importTopics, options) =>
    lambdaClient.topic.batchCreateTopics.mutate({
      expectedConversationVersion: options?.expectedConversationVersion,
      topics: importTopics,
    });

  cloneTopic: ITopicService['cloneTopic'] = (id, newTitle, options) =>
    lambdaClient.topic.cloneTopic.mutate({
      expectedConversationVersion: options?.expectedConversationVersion,
      id,
      newTitle,
    });

  getTopics: ITopicService['getTopics'] = (params) =>
    lambdaClient.topic.getTopics.query({
      ...params,
      containerId: this.toDbSessionId(params.containerId),
    }) as any;

  listTopicsForAgentMemoryRollup: ITopicService['listTopicsForAgentMemoryRollup'] = (
    agentId,
    limit,
  ) =>
    lambdaClient.topic.listTopicsForAgentMemoryRollup.query({
      agentId,
      limit,
    }) as any;

  getAllTopics: ITopicService['getAllTopics'] = () =>
    lambdaClient.topic.getAllTopics.query() as any;

  countTopics: ITopicService['countTopics'] = async (params) => {
    return lambdaClient.topic.countTopics.query(params);
  };

  rankTopics: ITopicService['rankTopics'] = async (limit) => {
    return lambdaClient.topic.rankTopics.query(limit);
  };

  searchTopics: ITopicService['searchTopics'] = (keywords, sessionId) =>
    lambdaClient.topic.searchTopics.query({
      keywords,
      sessionId: this.toDbSessionId(sessionId),
    }) as any;

  mergeReportedInputTokenFloorWatermark: ITopicService['mergeReportedInputTokenFloorWatermark'] = (
    id,
  ) => lambdaClient.topic.mergeReportedInputTokenFloorWatermark.mutate({ id });

  updateTopic: ITopicService['updateTopic'] = (id, data, options) =>
    lambdaClient.topic.updateTopic.mutate({ id, ...options, value: data });

  removeTopic: ITopicService['removeTopic'] = (id) => lambdaClient.topic.removeTopic.mutate({ id });

  removeTopics: ITopicService['removeTopics'] = (sessionId) =>
    lambdaClient.topic.batchDeleteBySessionId.mutate({ id: this.toDbSessionId(sessionId) });

  batchRemoveTopics: ITopicService['batchRemoveTopics'] = (topics) =>
    lambdaClient.topic.batchDelete.mutate({ ids: topics });

  removeAllTopic: ITopicService['removeAllTopic'] = () =>
    lambdaClient.topic.removeAllTopics.mutate();

  private toDbSessionId = (sessionId?: string | null) =>
    sessionId === INBOX_SESSION_ID ? null : sessionId;
}
