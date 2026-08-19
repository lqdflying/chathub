import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';

import type { ChatAIChatState } from '../slices/aiChat/initialState';

type ChatLoadingLaneSlice = Pick<
  ChatAIChatState,
  'chatLoadingAbortControllersByLane' | 'chatLoadingIdsAbortController'
>;

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
