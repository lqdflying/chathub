import type { AIChatModelCard } from '../types/aiModel';

/**
 * Builtin seed list for the OpenAI-compatible provider. Final models come from:
 * - Server env `OPENAICOMPATIBLE_MODEL_LIST` (merged like other providers, e.g. `+id=Display`, comma-separated), and/or
 * - Web console: API base URL, API key, and custom model ids / display names.
 */
const openaicompatibleChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Example placeholder. Set real model ids via Settings or `OPENAICOMPATIBLE_MODEL_LIST` to match your gateway.',
    displayName: 'gpt-3.5-turbo (example)',
    enabled: true,
    id: 'gpt-3.5-turbo',
    type: 'chat',
  },
];

export default openaicompatibleChatModels;
