import { azureFoundryChatModels } from './azure';

/** Azure AI / Foundry uses the same 2026 GPT-5.x ids as Azure OpenAI, without deployment names. */
export const allModels = [...azureFoundryChatModels];

export default allModels;
