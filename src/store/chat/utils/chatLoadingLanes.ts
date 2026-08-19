import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';

import type { ChatAIChatState } from '../slices/aiChat/initialState';

type ChatLoadingLaneSlice = Pick<
  ChatAIChatState,
  | 'chatLoadingAbortControllersByLane'
  | 'chatLoadingIds'
  | 'chatLoadingIdsAbortController'
  | 'chatLoadingLaneByMessageId'
>;

export const abortChatLoadingLane = (
  state: ChatLoadingLaneSlice,
  laneKey: string,
  reason = MESSAGE_CANCEL_FLAT,
) => {
  state.chatLoadingAbortControllersByLane[laneKey]?.abort(reason);
};

export const clearChatLoadingLaneEntries = (
  state: ChatLoadingLaneSlice,
  laneKey: string,
): Pick<
  ChatAIChatState,
  | 'chatLoadingAbortControllersByLane'
  | 'chatLoadingIds'
  | 'chatLoadingIdsAbortController'
  | 'chatLoadingLaneByMessageId'
> => {
  const laneMessageIds = state.chatLoadingIds.filter(
    (messageId) => state.chatLoadingLaneByMessageId[messageId] === laneKey,
  );
  const nextLaneByMessageId = { ...state.chatLoadingLaneByMessageId };
  for (const messageId of laneMessageIds) {
    delete nextLaneByMessageId[messageId];
  }
  const nextLaneControllers = { ...state.chatLoadingAbortControllersByLane };
  delete nextLaneControllers[laneKey];
  const nextLoadingIds = state.chatLoadingIds.filter(
    (messageId) => !laneMessageIds.includes(messageId),
  );

  return {
    chatLoadingAbortControllersByLane: nextLaneControllers,
    chatLoadingIds: nextLoadingIds,
    chatLoadingIdsAbortController:
      nextLoadingIds.length > 0 ? state.chatLoadingIdsAbortController : undefined,
    chatLoadingLaneByMessageId: nextLaneByMessageId,
  };
};

export const abortAllChatLoadingLanes = (
  state: ChatLoadingLaneSlice,
  reason = MESSAGE_CANCEL_FLAT,
) => {
  for (const controller of Object.values(state.chatLoadingAbortControllersByLane)) {
    controller.abort(reason);
  }
  state.chatLoadingIdsAbortController?.abort(reason);
};

export const clearChatLoadingLaneMaps = (): Pick<
  ChatAIChatState,
  | 'chatLoadingAbortControllersByLane'
  | 'chatLoadingIds'
  | 'chatLoadingIdsAbortController'
  | 'chatLoadingLaneByMessageId'
  | 'conversationLaneStopMarkers'
> => ({
  chatLoadingAbortControllersByLane: {},
  chatLoadingIds: [],
  chatLoadingIdsAbortController: undefined,
  chatLoadingLaneByMessageId: {},
  conversationLaneStopMarkers: {},
});
