import { produce } from 'immer';

import { CreateTopicParams } from '@/services/topic/type';
import { ChatTopic } from '@/types/topic';

interface AddChatTopicAction {
  type: 'addTopic';
  value: CreateTopicParams & { id?: string };
}

interface UpdateChatTopicAction {
  id: string;
  touchActivity?: boolean;
  type: 'updateTopic';
  value: Partial<ChatTopic>;
}

interface UpdateTopicsAction {
  type: 'updateTopics';
  value: ChatTopic[];
}

interface DeleteChatTopicAction {
  id: string;
  type: 'deleteTopic';
}

export type ChatTopicDispatch =
  | AddChatTopicAction
  | UpdateChatTopicAction
  | DeleteChatTopicAction
  | UpdateTopicsAction;

const compareTopicsByActivity = (firstTopic: ChatTopic, secondTopic: ChatTopic): number => {
  const favoriteDifference = Number(secondTopic.favorite) - Number(firstTopic.favorite);
  if (favoriteDifference !== 0) return favoriteDifference;

  const firstActivity = firstTopic.lastActivityAt ?? firstTopic.updatedAt;
  const secondActivity = secondTopic.lastActivityAt ?? secondTopic.updatedAt;
  return secondActivity - firstActivity;
};

export const topicReducer = (state: ChatTopic[] = [], payload: ChatTopicDispatch): ChatTopic[] => {
  switch (payload.type) {
    case 'addTopic': {
      return produce(state, (draftState) => {
        draftState.unshift({
          ...payload.value,
          createdAt: Date.now(),
          favorite: false,
          id: payload.value.id ?? Date.now().toString(),
          lastActivityAt: Date.now(),
          sessionId: payload.value.sessionId ? payload.value.sessionId : undefined,
          updatedAt: Date.now(),
        });

        return draftState.sort(compareTopicsByActivity);
      });
    }

    case 'updateTopic': {
      return produce(state, (draftState) => {
        const { value, id } = payload;
        const topicIndex = draftState.findIndex((topic) => topic.id === id);

        if (topicIndex !== -1) {
          const activityTimestamp = payload.touchActivity
            ? Date.now()
            : value.lastActivityAt ?? draftState[topicIndex].lastActivityAt;
          draftState[topicIndex] = {
            ...draftState[topicIndex],
            ...value,
            lastActivityAt: activityTimestamp,
            updatedAt: Date.now(),
          };
        }
      });
    }

    case 'updateTopics': {
      return [...payload.value].sort(compareTopicsByActivity);
    }

    case 'deleteTopic': {
      return produce(state, (draftState) => {
        const topicIndex = draftState.findIndex((topic) => topic.id === payload.id);
        if (topicIndex !== -1) {
          draftState.splice(topicIndex, 1);
        }
      });
    }

    default: {
      return state;
    }
  }
};
