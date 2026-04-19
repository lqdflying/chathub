import type { AIChatModelCard } from '../types/aiModel';

/**
 * Builtin seed list for the OpenAI-compatible provider. Final models come from:
 * - Server env `OPENAICOMPATIBLE_MODEL_LIST` (merged like other providers, e.g. `+id=Display`, comma-separated), and/or
 * - Web console: API base URL, API key, and custom model ids / display names.
 *
 * Default targets MiniMax M2.7 on OpenAI-compatible gateways (e.g. `minimaxai/minimax-m2.7`).
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
      'MiniMax M2.7 via OpenAI-compatible Chat Completions. Override model id in Settings or `OPENAICOMPATIBLE_MODEL_LIST` if your gateway uses a different name.',
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'minimaxai/minimax-m2.7',
    type: 'chat',
  },
];

export default openaicompatibleChatModels;
