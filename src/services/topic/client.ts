import { INBOX_SESSION_ID } from '@/const/session';
import { clientDB } from '@/database/client/db';
import { TopicModel } from '@/database/models/topic';
import { BaseClientService } from '@/services/baseClientService';
import { withClientConversationWriteQueue } from '@/services/conversationWriteQueue';
import { ChatTopic } from '@/types/topic';

import { ITopicService } from './type';

export class ClientService extends BaseClientService implements ITopicService {
  private get topicModel(): TopicModel {
    return new TopicModel(clientDB as any, this.userId);
  }

  createTopic: ITopicService['createTopic'] = async (params, options) => {
    const item = await withClientConversationWriteQueue(
      this.userId,
      (transaction) =>
        new TopicModel(transaction, this.userId).create({
          ...params,
          sessionId: this.toDbSessionId(params.sessionId),
        } as any),
      options?.expectedConversationVersion,
    );

    if (!item) {
      throw new Error('topic create Error');
    }

    return item.id;
  };

  batchCreateTopics: ITopicService['batchCreateTopics'] = async (importTopics, options) => {
    const data = await withClientConversationWriteQueue(
      this.userId,
      (transaction) => new TopicModel(transaction, this.userId).batchCreate(importTopics as any),
      options?.expectedConversationVersion,
    );

    return { added: data.length, ids: [], skips: [], success: true };
  };

  cloneTopic: ITopicService['cloneTopic'] = async (id, newTitle, options) => {
    const data = await withClientConversationWriteQueue(
      this.userId,
      (transaction) => new TopicModel(transaction, this.userId).duplicate(id, newTitle),
      options?.expectedConversationVersion,
    );
    return data.topic.id;
  };

  getTopics: ITopicService['getTopics'] = async (params) => {
    const data = await this.topicModel.query({
      ...params,
      containerId: this.toDbSessionId(params.containerId),
    });
    return data as unknown as Promise<ChatTopic[]>;
  };

  listTopicsForAgentMemoryRollup: ITopicService['listTopicsForAgentMemoryRollup'] = async (
    agentId,
    limit,
  ) => {
    return this.topicModel.listTopicsForAgentMemoryRollup(agentId, limit);
  };

  searchTopics: ITopicService['searchTopics'] = async (keyword, sessionId) => {
    const data = await this.topicModel.queryByKeyword(keyword, this.toDbSessionId(sessionId));

    return data as unknown as Promise<ChatTopic[]>;
  };

  getAllTopics: ITopicService['getAllTopics'] = async () => {
    const data = await this.topicModel.queryAll();

    return data as unknown as Promise<ChatTopic[]>;
  };

  countTopics: ITopicService['countTopics'] = async (params) => {
    return this.topicModel.count(params);
  };

  rankTopics: ITopicService['rankTopics'] = async (limit) => {
    return this.topicModel.rank(limit);
  };

  updateTopic: ITopicService['updateTopic'] = async (id, data, options) => {
    return this.topicModel.update(id, data as any, options);
  };

  removeTopic: ITopicService['removeTopic'] = async (id) => {
    return this.topicModel.delete(id);
  };

  removeTopics: ITopicService['removeTopics'] = async (sessionId) => {
    return this.topicModel.batchDeleteBySessionId(this.toDbSessionId(sessionId));
  };

  batchRemoveTopics: ITopicService['batchRemoveTopics'] = async (topics) => {
    return this.topicModel.batchDelete(topics);
  };

  removeAllTopic: ITopicService['removeAllTopic'] = async () => {
    return this.topicModel.deleteAll();
  };

  private toDbSessionId(sessionId?: string | null) {
    return sessionId === INBOX_SESSION_ID ? null : sessionId;
  }
}
