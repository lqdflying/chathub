import type { OpenAIChatMessage } from '@lobechat/types';
import { minimax as minimaxModels } from 'model-bank';

import { encodeAsync } from '@/utils/tokenizer';

/** Extra reserved tokens for JSON overhead / MiniMax counting vs our estimate. */
const SAFETY_MARGIN = 4096;

/**
 * MiniMax returns `invalid params, context window exceeds limit (2013)` when the full
 * request (messages + tools + typical completion) exceeds their window. Their total
 * budget is ~`contextWindow`; completion can require up to `max_output` tokens, so the
 * effective prompt budget is roughly `contextWindow - max_output` (see model card).
 *
 * Do not import the client AI-infra store here. This helper is used by the Graphile
 * worker / `instrumentation` graph; Next.js fails `next build` if a server module
 * imports files that use React client hooks
 * (https://nextjs.org/docs/messages/react-client-hook-in-server-component).
 */
const estimateRequestTokens = async (
  messages: OpenAIChatMessage[],
  tools: unknown[] | undefined,
): Promise<number> => {
  return encodeAsync(JSON.stringify({ messages, tools: tools ?? [] }));
};

export async function trimMinimaxChatContext(
  messages: OpenAIChatMessage[],
  tools: unknown[] | undefined,
  model: string,
  maxTokensRequest?: number,
  contextWindowTokens?: number,
): Promise<OpenAIChatMessage[]> {
  const modelRow = minimaxModels.find((m) => m.id === model);
  const contextWindow = contextWindowTokens || modelRow?.contextWindowTokens || 204_800;
  const modelMaxOut = modelRow?.maxOutput ?? 65_536;
  const completionReserve =
    maxTokensRequest !== undefined && maxTokensRequest > 0
      ? Math.min(maxTokensRequest, modelMaxOut)
      : modelMaxOut;

  let budget = contextWindow - completionReserve - SAFETY_MARGIN;
  if (!Number.isFinite(budget) || budget < 8192) {
    budget = Math.max(8192, Math.floor(contextWindow * 0.35));
  }

  if ((await estimateRequestTokens(messages, tools)) <= budget) return messages;

  let sysEnd = 0;
  while (sysEnd < messages.length && messages[sysEnd].role === 'system') {
    sysEnd++;
  }

  let lo = sysEnd;
  let hi = messages.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = [...messages.slice(0, sysEnd), ...messages.slice(mid)];
    const t = await estimateRequestTokens(candidate, tools);
    if (t <= budget) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  let trimmed = [...messages.slice(0, sysEnd), ...messages.slice(lo)];
  while (
    (await estimateRequestTokens(trimmed, tools)) > budget &&
    trimmed.length > sysEnd + 2
  ) {
    lo++;
    trimmed = [...messages.slice(0, sysEnd), ...messages.slice(lo)];
  }

  if (trimmed.length < messages.length) {
    console.warn(
      `[MiniMax] Trimmed chat context (${messages.length} → ${trimmed.length} messages) to stay under estimated input budget (~${budget} tokens).`,
    );
  }

  return trimmed;
}
