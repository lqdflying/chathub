import type { UIChatMessage } from '@lobechat/types';

import { contextTokenCounter, warmContextTokenCache, type TextTokenCounter } from './contextTokenCount';
import {
  resolveEffectiveHistoryWindow,
  type EffectiveHistoryWindow,
  type MessageLikeForHistoryWindow,
} from './contextCompaction';
import {
  estimateMessageVisualTokens,
  stripInlineImagePayloads,
  type VisualTokenEstimate,
} from './imageTokenEstimate';
import {
  estimateFixedContextOverheadTokens,
  fixedContextOverheadText,
  serializeMessageForContextEstimate,
  type MessageLikeForContextEstimate,
} from './contextUsageEstimate';

/** Framing allowance for one message on the wire. */
export const MESSAGE_FRAMING_TOKENS = 3;

export interface CountedMessageTokens {
  textTokens: number;
  totalTokens: number;
  visual: VisualTokenEstimate;
}

export const messageTextForTokenCount = (
  message: MessageLikeForContextEstimate,
  inputTemplate?: string,
): string =>
  stripInlineImagePayloads(serializeMessageForContextEstimate(message, inputTemplate));

export const countMessageContextTokens = (
  message: MessageLikeForHistoryWindow &
    Partial<Pick<UIChatMessage, 'imageList' | 'videoList'>>,
  inputTemplate: string | undefined,
  modelId: string | undefined,
  countText: TextTokenCounter = contextTokenCounter,
): CountedMessageTokens => {
  const textTokens = countText(messageTextForTokenCount(message, inputTemplate));
  const visual = estimateMessageVisualTokens(message, modelId);
  return {
    textTokens,
    totalTokens: textTokens + MESSAGE_FRAMING_TOKENS + visual.tokens,
    visual,
  };
};

export const resolveTokenizerHistoryWindow = async ({
  enableHistoryCount,
  historyCount,
  inputTemplate,
  maxTokens,
  messages,
  modelId,
  overhead,
}: {
  enableHistoryCount?: boolean;
  historyCount?: number;
  inputTemplate?: string;
  maxTokens?: number;
  messages: Array<
    MessageLikeForHistoryWindow & Partial<Pick<UIChatMessage, 'imageList' | 'videoList'>>
  >;
  modelId?: string;
  overhead: Parameters<typeof fixedContextOverheadText>[0];
}): Promise<EffectiveHistoryWindow> => {
  const overheadText = fixedContextOverheadText(overhead);
  const warmed = await warmContextTokenCache([
    overheadText,
    ...messages.map((message) => messageTextForTokenCount(message, inputTemplate)),
  ]);
  return resolveEffectiveHistoryWindow({
    enableHistoryCount,
    fixedOverheadTokens: estimateFixedContextOverheadTokens(overhead, warmed.count),
    historyCount,
    inputTemplate,
    maxTokens,
    messageTokenCount: (message) =>
      countMessagesContextTokens([message], inputTemplate, modelId, warmed.count).totalTokens,
    messagesAfterCursor: messages,
  });
};

export const countMessagesContextTokens = (
  messages: Array<
    MessageLikeForHistoryWindow & Partial<Pick<UIChatMessage, 'imageList' | 'videoList'>>
  >,
  inputTemplate: string | undefined,
  modelId: string | undefined,
  countText: TextTokenCounter = contextTokenCounter,
): { hasVisual: boolean; textTokens: number; totalTokens: number; visualTokens: number } => {
  let textTokens = 0;
  let visualTokens = 0;
  let hasVisual = false;
  for (const message of messages) {
    const counted = countMessageContextTokens(message, inputTemplate, modelId, countText);
    textTokens += counted.textTokens + MESSAGE_FRAMING_TOKENS;
    visualTokens += counted.visual.tokens;
    hasVisual = hasVisual || counted.visual.hasVisual;
  }
  return { hasVisual, textTokens, totalTokens: textTokens + visualTokens, visualTokens };
};
