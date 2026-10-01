import type { LobeAgentConfig } from '@lobechat/types';

import type { ChatStoreState } from '@/store/chat/initialState';

import { estimateContextUsageAsync, type EstimateContextUsageScope } from './estimateContextUsageAsync';

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

/**
 * Raw local token count for the conversation that is about to be sent.
 * Does not read the visible topic or its draft.
 */
export const captureDispatchTokenEstimate = async ({
  agentConfig,
  chatState,
  isGroupSession,
  pendingHasFiles,
  pendingInput,
  sessionId,
  threadId,
  topicId,
}: {
  agentConfig: LobeAgentConfig;
  chatState: ChatStoreState;
  isGroupSession?: boolean;
  pendingHasFiles?: boolean;
  pendingInput?: string;
  sessionId: string;
  threadId?: string | null;
  topicId?: string | null;
}): Promise<DispatchTokenEstimate | undefined> => {
  try {
    const model = agentConfig.model;
    const provider = agentConfig.provider;
    if (!model || !provider || !sessionId) return undefined;

    const scope: EstimateContextUsageScope = {
      agentConfig: { ...agentConfig, model, provider },
      isGroupSession,
      pendingHasFiles,
      pendingInput,
      sessionId,
      threadId,
      topicId,
    };
    const estimate = await estimateContextUsageAsync({
      chatState,
      multiplier: 1,
      scope,
    });
    if (!Number.isFinite(estimate.rawLocalTokens) || estimate.rawLocalTokens <= 0) {
      return undefined;
    }

    return {
      eligible: estimate.tokenEstimateEligible,
      model,
      provider,
      uncalibratedInputTokens: estimate.rawLocalTokens,
    };
  } catch {
    return undefined;
  }
};
