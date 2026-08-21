import type { ChatAIChatState } from '../slices/aiChat/initialState';

export const collectDeferredBrowserGenerationMessageIds = (
  lanes: ChatAIChatState['deferredBrowserGenerationLanes'] | undefined,
): Set<string> => {
  const ids = new Set<string>();
  for (const lane of Object.values(lanes || {})) {
    if (lane.assistantMessageId) ids.add(lane.assistantMessageId);
  }
  return ids;
};
