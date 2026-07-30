import { ChatStreamPayload, UIChatMessage } from '@lobechat/types';

import { chatHistoryPrompts } from '../prompts';

export const chainSummaryHistory = (
  messages: UIChatMessage[],
  previousSummary?: string,
): Partial<ChatStreamPayload> => {
  const existingSummary = previousSummary?.trim();

  return {
    messages: [
      {
        content: `You maintain a compact, cumulative memory of a conversation. Merge new chat history into the existing summary when one is provided. Preserve the conversation's original language. Keep durable facts, user preferences, decisions, constraints, technical identifiers, completed work, and unresolved tasks. Replace superseded facts instead of retaining contradictions. Do not invent details. Return only the updated summary, limited to 400 tokens.`,
        role: 'system',
      },
      {
        content: `${
          existingSummary ? `<existing_summary>\n${existingSummary}\n</existing_summary>\n\n` : ''
        }${chatHistoryPrompts(messages)}

Merge the new conversation content into a self-contained cumulative summary.`,
        role: 'user',
      },
    ],
  };
};
