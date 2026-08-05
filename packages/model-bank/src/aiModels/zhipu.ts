import type { AIChatModelCard } from '../types/aiModel';

// https://docs.z.ai/guides/llm/glm-5.2
// https://docs.z.ai/guides/overview/concept-param
// https://docs.z.ai/guides/capabilities/thinking
const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.2 is Zhipu\'s flagship text-only coding/agent model with a 1M-token context window, Deep Thinking, and GLM-5.2-only reasoning_effort control. Web search and JSON mode require thinking disabled.',
    displayName: 'GLM-5.2',
    enabled: true,
    id: 'glm-5.2',
    maxOutput: 65_536,
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
    maxOutput: 65_536,
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
    maxOutput: 65_536,
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
    maxOutput: 65_536,
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
      structuredOutput: true,
    },
    contextWindowTokens: 204_800,
    description:
      'GLM-4.7 is a text model with forced Deep Thinking (thinking always on) and a 200K context window.',
    displayName: 'GLM-4.7',
    id: 'glm-4.7',
    maxOutput: 65_536,
    releasedAt: '2025-12-01',
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
      'GLM-4.6 is a text model with Deep Thinking support and a 200K context window.',
    displayName: 'GLM-4.6',
    id: 'glm-4.6',
    maxOutput: 65_536,
    releasedAt: '2025-10-01',
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
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5 is a text model with Deep Thinking support and a 128K context window.',
    displayName: 'GLM-4.5',
    id: 'glm-4.5',
    maxOutput: 65_536,
    releasedAt: '2025-07-01',
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
    maxOutput: 65_536,
    releasedAt: '2026-05-01',
    settings: {
      extendParams: ['enableReasoning', 'zhipuPreservedThinking'],
    },
    type: 'chat',
  },
];

export default zhipuChatModels;