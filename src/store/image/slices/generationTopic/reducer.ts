import { produce } from 'immer';

import { UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import { ImageGenerationTopic } from '@/types/generation';

interface AddGenerationTopicAction {
  type: 'addTopic';
  value: Partial<ImageGenerationTopic> & { id: string };
}

interface UpdateGenerationTopicAction {
  id: string;
  type: 'updateTopic';
  value: UpdateTopicValue;
}

interface DeleteGenerationTopicAction {
  id: string;
  type: 'deleteTopic';
}

interface ReplaceGenerationTopicAction {
  id: string;
  type: 'replaceTopic';
  value: Partial<ImageGenerationTopic> & { id: string };
}

export type GenerationTopicDispatch =
  | AddGenerationTopicAction
  | UpdateGenerationTopicAction
  | DeleteGenerationTopicAction
  | ReplaceGenerationTopicAction;

export const generationTopicReducer = (
  state: ImageGenerationTopic[] = [],
  payload: GenerationTopicDispatch,
): ImageGenerationTopic[] => {
  switch (payload.type) {
    case 'addTopic': {
      return produce(state, (draftState) => {
        const now = new Date();
        draftState.unshift({
          title: payload.value.title || null,
          coverUrl: payload.value.coverUrl || null,
          createdAt: payload.value.createdAt || now,
          updatedAt: payload.value.updatedAt || now,
          ...payload.value,
        });
      });
    }

    case 'updateTopic': {
      return produce(state, (draftState) => {
        const index = draftState.findIndex((topic) => topic.id === payload.id);
        if (index !== -1) {
          draftState[index] = {
            ...draftState[index],
            ...payload.value,
            updatedAt: new Date(),
          };
        }
      });
    }

    case 'deleteTopic': {
      return state.filter((topic) => topic.id !== payload.id);
    }

    case 'replaceTopic': {
      return produce(state, (draftState) => {
        const currentIndex = draftState.findIndex((topic) => topic.id === payload.id);
        const replacementIndex = draftState.findIndex((topic) => topic.id === payload.value.id);

        if (replacementIndex !== -1) {
          if (currentIndex !== -1 && currentIndex !== replacementIndex) {
            draftState.splice(currentIndex, 1);
          }
          return;
        }

        if (currentIndex !== -1) {
          draftState[currentIndex] = {
            ...draftState[currentIndex],
            ...payload.value,
          };
          return;
        }

        const now = new Date();
        draftState.unshift({
          title: payload.value.title || null,
          coverUrl: payload.value.coverUrl || null,
          createdAt: payload.value.createdAt || now,
          updatedAt: payload.value.updatedAt || now,
          ...payload.value,
        });
      });
    }

    default: {
      return state;
    }
  }
};
