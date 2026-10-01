import type { ChatStoreState } from '@/store/chat/initialState';
import { agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';

import { estimateContextUsageAsync } from './estimateContextUsageAsync';

export interface DispatchTokenEstimate {
  eligible: boolean;
  model: string;
  provider: string;
  uncalibratedInputTokens: number;
}

const pending = new Map<string, DispatchTokenEstimate>();
const PENDING_LIMIT = 100;

export const rememberDispatchTokenEstimate = (
  assistantMessageId: string,
  estimate: DispatchTokenEstimate,
) => {
  if (!assistantMessageId) return;
  pending.delete(assistantMessageId);
  pending.set(assistantMessageId, estimate);
  while (pending.size > PENDING_LIMIT) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
};

export const consumeDispatchTokenEstimate = (
  assistantMessageId: string,
): DispatchTokenEstimate | undefined => {
  const estimate = pending.get(assistantMessageId);
  if (estimate) pending.delete(assistantMessageId);
  return estimate;
};

/** Uncalibrated next-request total for the chat state about to be sent. */
export const captureDispatchTokenEstimate = async (
  chatState: ChatStoreState,
): Promise<DispatchTokenEstimate | undefined> => {
  try {
    const agentState = getAgentStoreState();
    const model = agentSelectors.currentAgentModel(agentState);
    const provider = agentSelectors.currentAgentModelProvider(agentState);
    if (!model || !provider) return undefined;

    const estimate = await estimateContextUsageAsync({
      agentState,
      chatState,
      multiplier: 1,
    });
    if (!Number.isFinite(estimate.uncalibratedTokens) || estimate.uncalibratedTokens <= 0) {
      return undefined;
    }

    return {
      eligible: estimate.tokenEstimateEligible,
      model,
      provider,
      uncalibratedInputTokens: estimate.uncalibratedTokens,
    };
  } catch {
    return undefined;
  }
};
