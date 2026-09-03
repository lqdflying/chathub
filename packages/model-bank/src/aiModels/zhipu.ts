import type { AIChatModelCard } from '../types/aiModel';

// https://docs.z.ai/guides/llm/glm-5.3
// https://docs.z.ai/guides/vlm/glm-5.3-flash
// https://docs.z.ai/guides/llm/glm-5.2
// https://docs.z.ai/guides/overview/concept-param
// https://docs.z.ai/guides/capabilities/thinking
// Max output per https://docs.z.ai/api-reference/llm/chat-completion:
//   GLM-5.3/5.3-Flash/5.2/5.1/5/5-turbo: 128K (131072).
const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.3 is Zhipu\'s flagship text-only coding/agent model with a 1M-token context window. Deep Thinking is forced (disabling it errors); reasoning_effort is low, high, or max (default max).',
    displayName: 'GLM-5.3',
    enabled: true,
    id: 'glm-5.3',
    maxOutput: 131_072,
    releasedAt: '2026-08-26',
    settings: {
      extendParams: ['zhipuReasoningEffort', 'zhipuPreservedThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.3-Flash is the native multimodal GLM-5.3 variant (image, video, and file input) with a 1M-token context window. Deep Thinking is forced; reasoning_effort is low, high, or max (default max). Vision request schema does not expose web_search.',
    displayName: 'GLM-5.3-Flash',
    enabled: true,
    id: 'glm-5.3-flash',
    maxOutput: 131_072,
    releasedAt: '2026-08-26',
    settings: {
      extendParams: ['zhipuReasoningEffort', 'zhipuPreservedThinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.2 is Zhipu\'s previous flagship text-only coding/agent model with a 1M-token context window, Deep Thinking, and GLM-5.2-only reasoning_effort control.',
    displayName: 'GLM-5.2',
    enabled: true,
    id: 'glm-5.2',
    maxOutput: 131_072,
    releasedAt: '2026-06-13',
    settings: {
      extendParams: ['enableReasoning', 'zhipuReasoningEffort', 'zhipuPreservedThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 204_800,
    description:
      'GLM-5.1 is the previous flagship text model with a 200K context window and Deep Thinking support.',
    displayName: 'GLM-5.1',
    enabled: true,
    id: 'glm-5.1',
    maxOutput: 131_072,
    releasedAt: '2026-03-01',
    settings: {
      extendParams: ['enableReasoning', 'zhipuPreservedThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 204_800,
    description:
      'GLM-5 is an older flagship text model with a 200K context window and Deep Thinking support.',
    displayName: 'GLM-5',
    id: 'glm-5',
    maxOutput: 131_072,
    releasedAt: '2026-01-01',
    settings: {
      extendParams: ['enableReasoning', 'zhipuPreservedThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 204_800,
    description:
      'GLM-5-Turbo is the agent-optimized text variant with a 200K context window and Deep Thinking support.',
    displayName: 'GLM-5-Turbo',
    id: 'glm-5-turbo',
    maxOutput: 131_072,
    releasedAt: '2026-02-01',
    settings: {
      extendParams: ['enableReasoning', 'zhipuPreservedThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-5V-Turbo is the multimodal vision model, supporting image, video, and file inputs alongside Deep Thinking. Uses vision-model defaults (temperature 0.8, top_p 0.6). Vision request schema does not expose web_search.',
    displayName: 'GLM-5V-Turbo',
    id: 'glm-5v-turbo',
    maxOutput: 131_072,
    releasedAt: '2026-05-01',
    settings: {
      extendParams: ['enableReasoning', 'zhipuPreservedThinking'],
    },
    type: 'chat',
  },
];

export default zhipuChatModels;