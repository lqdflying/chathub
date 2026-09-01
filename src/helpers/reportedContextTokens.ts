import type { MessageMetadata, ModelTokensUsage, UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';

type UsageMessage = Pick<UIChatMessage, 'children' | 'content' | 'metadata' | 'role' | 'usage'>;

type NestedUsageMetadata = MessageMetadata & { usage?: ModelTokensUsage };

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const readTotalInput = (usage?: ModelTokensUsage | MessageMetadata | null): number | undefined => {
  if (!usage || typeof usage !== 'object') return undefined;
  const total = (usage as ModelTokensUsage).totalInputTokens;
  return isFinitePositive(total) ? total : undefined;
};

/** Newest settled assistant `totalInputTokens` in the supplied window. */
export const getLatestReportedInputTokens = (messages: UsageMessage[]): number | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if ((message.role !== 'assistant' && message.role !== 'group') || message.content === LOADING_FLAT) {
      continue;
    }

    const children = message.children;
    if (children?.length) {
      for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
        const childInput = readTotalInput(children[childIndex].usage);
        if (childInput) return childInput;
      }
    }

    const nested = (message.metadata as NestedUsageMetadata | undefined)?.usage;
    const value = readTotalInput(message.usage) ?? readTotalInput(nested) ?? readTotalInput(message.metadata);
    if (value) return value;
  }

  return undefined;
};

export const applyReportedInputTokenFloor = (
  estimatedTotal: number,
  reportedInput?: number,
): { chatsTokenDelta: number; totalToken: number } => {
  if (!reportedInput || reportedInput <= estimatedTotal) {
    return { chatsTokenDelta: 0, totalToken: estimatedTotal };
  }
  return {
    chatsTokenDelta: reportedInput - estimatedTotal,
    totalToken: reportedInput,
  };
};
