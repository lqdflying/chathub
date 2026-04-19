export enum ModelProvider {
  Anthropic = 'anthropic',
  Azure = 'azure',
  AzureAI = 'azureai',
  Google = 'google',
  Minimax = 'minimax',
  Moonshot = 'moonshot',
  OpenAI = 'openai',
  /** Any OpenAI-compatible HTTP API (custom base URL + API key); model id is user-defined */
  OpenAICompatible = 'openaicompatible',
}
