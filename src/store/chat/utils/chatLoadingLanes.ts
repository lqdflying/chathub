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

export const abortChatLoadingLanesExceptMessageIds = (
  state: ChatLoadingLaneSlice,
  preserveMessageIds: Set<string>,
  reason = MESSAGE_CANCEL_FLAT,
) => {
  if (preserveMessageIds.size === 0) {
    abortAllChatLoadingLanes(state, reason);
    return;
  }

  const preserveLaneKeys = new Set(
    Object.entries(state.chatLoadingLaneByMessageId)
      .filter(([messageId]) => preserveMessageIds.has(messageId))
      .map(([, laneKey]) => laneKey),
  );

  for (const [laneKey, controller] of Object.entries(state.chatLoadingAbortControllersByLane)) {
    if (preserveLaneKeys.has(laneKey)) continue;
    controller.abort(reason);
  }

  const globalController = state.chatLoadingIdsAbortController;
  if (!globalController) return;
  const globalIsPreserved = Object.entries(state.chatLoadingAbortControllersByLane).some(
    ([laneKey, controller]) => preserveLaneKeys.has(laneKey) && controller === globalController,
  );
  if (!globalIsPreserved) globalController.abort(reason);
};

export const preserveChatLoadingLaneMapsForMessages = (
  state: ChatLoadingLaneSlice,
  preserveMessageIds: Set<string>,
): Pick<
  ChatAIChatState,
  | 'chatLoadingAbortControllersByLane'
  | 'chatLoadingIds'
  | 'chatLoadingIdsAbortController'
  | 'chatLoadingLaneByMessageId'
> => {
  if (preserveMessageIds.size === 0) return clearChatLoadingLaneMaps();

  const preservedIds = state.chatLoadingIds.filter((messageId) =>
    preserveMessageIds.has(messageId),
  );
  const nextLaneByMessageId: Record<string, string> = {};
  const preserveLaneKeys = new Set<string>();
  for (const messageId of preservedIds) {
    const laneKey = state.chatLoadingLaneByMessageId[messageId];
    if (!laneKey) continue;
    nextLaneByMessageId[messageId] = laneKey;
    preserveLaneKeys.add(laneKey);
  }

  const nextLaneControllers: Record<string, AbortController> = {};
  for (const laneKey of preserveLaneKeys) {
    const controller = state.chatLoadingAbortControllersByLane[laneKey];
    if (controller) nextLaneControllers[laneKey] = controller;
  }

  const globalController = state.chatLoadingIdsAbortController;
  const keepGlobal =
    Boolean(globalController) &&
    Object.values(nextLaneControllers).some((controller) => controller === globalController);

  return {
    chatLoadingAbortControllersByLane: nextLaneControllers,
    chatLoadingIds: preservedIds,
    chatLoadingIdsAbortController: keepGlobal
      ? globalController
      : Object.values(nextLaneControllers)[0],
    chatLoadingLaneByMessageId: nextLaneByMessageId,
  };
};

/**
 * Resets the per-lane chat loading bookkeeping. Stop markers deliberately
 * survive: destructive clears install tombstones before calling this, and wiping
 * them here would let pre-clear durable jobs reattach when sync discovers them.
 */
export const clearChatLoadingLaneMaps = (): Pick<
  ChatAIChatState,
  | 'chatLoadingAbortControllersByLane'
  | 'chatLoadingIds'
  | 'chatLoadingIdsAbortController'
  | 'chatLoadingLaneByMessageId'
> => ({
  chatLoadingAbortControllersByLane: {},
  chatLoadingIds: [],
  chatLoadingIdsAbortController: undefined,
  chatLoadingLaneByMessageId: {},
});
