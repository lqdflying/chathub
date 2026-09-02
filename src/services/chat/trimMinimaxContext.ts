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
  budget: number,
): Promise<number> => {
  const serialized = JSON.stringify({ messages, tools: tools ?? [] });
  const utf8ByteUpperBound = new TextEncoder().encode(serialized).byteLength;

  // Byte-level BPE cannot produce more tokens than the UTF-8 bytes it starts
  // from. This fast path proves short requests fit without starting the
  // tokenizer worker, which can be unavailable in mobile Safari/PWA contexts.
  if (utf8ByteUpperBound <= budget) return utf8ByteUpperBound;

  try {
    return await encodeAsync(serialized);
  } catch {
    // Preserve the context guard when exact tokenization is unavailable. The
    // UTF-8 byte count is conservative, so it may trim early but never expands
    // a request beyond the configured budget.
    return utf8ByteUpperBound;
  }
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

  if ((await estimateRequestTokens(messages, tools, budget)) <= budget) return messages;

  let sysEnd = 0;
  while (sysEnd < messages.length && messages[sysEnd].role === 'system') {
    sysEnd++;
  }

  let lo = sysEnd;
  let hi = messages.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = [...messages.slice(0, sysEnd), ...messages.slice(mid)];
    const t = await estimateRequestTokens(candidate, tools, budget);
    if (t <= budget) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  let trimmed = [...messages.slice(0, sysEnd), ...messages.slice(lo)];
  while (
    (await estimateRequestTokens(trimmed, tools, budget)) > budget &&
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
