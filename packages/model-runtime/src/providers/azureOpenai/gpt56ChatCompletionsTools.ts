/**
 * Azure GPT-5.6 Chat Completions rejects function tools unless reasoning_effort is none.
 * Microsoft recommends Responses for tool calling; ChatHub's Azure adapters stay on
 * Chat Completions, so tool chats force `none`. Tool-free requests keep the selected effort.
 * https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning#tool-calling-with-reasoning-models
 */
export const isAzureGpt56Model = (model: string): boolean => model.startsWith('gpt-5.6');

export const hasChatCompletionTools = (tools: unknown): boolean =>
  Array.isArray(tools) && tools.length > 0;

export const resolveAzureChatCompletionsReasoningEffort = (
  model: string,
  tools: unknown,
  reasoningEffort: string | undefined,
): string | undefined => {
  if (isAzureGpt56Model(model) && hasChatCompletionTools(tools)) {
    return 'none';
  }
  return reasoningEffort;
};
