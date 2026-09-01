import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import type { ModelUsage } from '@lobechat/types';

/**
 * Provider accepted the request at the hard window but billed ~0 output and
 * returned no text/tools. MiMo/DeepSeek 1M cards report `totalInputTokens`
 * within a few tokens of `contextWindowTokens` (e.g. 1,048,570 / 1,048,576).
 */
export const isEmptyCompletionAtContextCeiling = ({
  content,
  contextWindowTokens,
  reasoning,
  toolCalls,
  usage,
}: {
  content?: string;
  contextWindowTokens?: number;
  reasoning?: { content?: string };
  toolCalls?: unknown[];
  usage?: Pick<ModelUsage, 'totalInputTokens' | 'totalOutputTokens'>;
}): boolean => {
  if (toolCalls?.length) return false;
  if (content?.trim()) return false;
  if (reasoning?.content?.trim()) return false;
  const window = contextWindowTokens;
  const input = usage?.totalInputTokens;
  const output = usage?.totalOutputTokens ?? 0;
  if (!window || window <= 0 || !input || input <= 0 || output > 0) return false;
  return input >= window - 256;
};

export const createEmptyCompletionAtContextCeilingError = ({
  contextWindowTokens,
  totalInputTokens,
  totalOutputTokens = 0,
}: {
  contextWindowTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}) => ({
  body: {
    contextWindowTokens,
    totalInputTokens,
    totalOutputTokens,
  },
  message: 'The model returned no completion because the prompt filled the context window.',
  type: AgentRuntimeErrorType.ExceededContextWindow,
});
