export enum ModelProvider {
  Anthropic = 'anthropic',
  /** Any Anthropic-compatible Messages API (custom base URL + API key); fixed model list */
  AnthropicCompatible = 'anthropiccompatible',
  Azure = 'azure',
  AzureAI = 'azureai',
  DeepSeek = 'deepseek',
  Google = 'google',
  Minimax = 'minimax',
  Moonshot = 'moonshot',
  OpenAI = 'openai',
  /** Any OpenAI-compatible HTTP API (custom base URL + API key); model id is user-defined */
  OpenAICompatible = 'openaicompatible',
  Zhipu = 'zhipu',
}
