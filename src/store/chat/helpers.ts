import { getSlicedMessages as getContextEngineSlicedMessages } from '@lobechat/context-engine';
import { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

import { encodeAsync } from '@/utils/tokenizer';

export const getMessagesTokenCount = async (messages: OpenAIChatMessage[]) =>
  encodeAsync(messages.map((m) => m.content).join(''));

export const getMessageById = (messages: UIChatMessage[], id: string) =>
  messages.find((m) => m.id === id);

const getSlicedMessages = (
  messages: UIChatMessage[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
    includeNewUserMessage?: boolean;
  },
): UIChatMessage[] => {
  const historyCount =
    !!options.includeNewUserMessage && options.historyCount !== undefined
      ? options.historyCount + 1
      : options.historyCount;

  return getContextEngineSlicedMessages(messages, {
    enableHistoryCount: options.enableHistoryCount,
    historyCount,
  });
};

export const chatHelpers = {
  getMessageById,
  getMessagesTokenCount,
  getSlicedMessages,
};
