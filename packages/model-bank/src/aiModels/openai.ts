import { ModelParamsSchema } from '../standard-parameters';
import {
  AIChatModelCard,
  AIEmbeddingModelCard,
  AIImageModelCard,
  AIRealtimeModelCard,
  AISTTModelCard,
  AITTSModelCard,
  AiModelSettings,
} from '../types/aiModel';

export const gptImage1ParamsSchema: ModelParamsSchema = {
  imageUrls: { default: [] },
  prompt: { default: '' },
  size: {
    default: 'auto',
    enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
  },
};

export const GPT_IMAGE_2_SIZE_PRESETS = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2560x1440',
  '1440x2560',
  '3840x2160',
  '2160x3840',
] as const;

export const gptImage2CompatibleParamsSchema: ModelParamsSchema = {
  ...gptImage1ParamsSchema,
  size: {
    custom: {
      experimentalPixelThreshold: 3_686_400,
      maxAspectRatio: 3,
      maxEdge: 3840,
      maxPixels: 8_294_400,
      minPixels: 655_360,
      step: 16,
    },
    default: 'auto',
    enum: [...GPT_IMAGE_2_SIZE_PRESETS],
    groups: [
      { key: 'standard', values: ['1024x1024', '1536x1024', '1024x1536'] },
      { key: '2k', values: ['2560x1440', '1440x2560'] },
      { key: '4k', values: ['3840x2160', '2160x3840'] },
    ],
  },
};

const gpt56Abilities = {
  functionCall: true,
  reasoning: true,
  search: true,
  structuredOutput: true,
  vision: true,
} as const;

const gpt56Settings: AiModelSettings = {
  extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
  searchImpl: 'params',
};

// Pricing: https://developers.openai.com/api/docs/pricing (short-context standard rates).
export const openaiChatModels: AIChatModelCard[] = [
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.6 Sol is OpenAI's frontier model for complex professional work, coding, and agentic workflows with an expanded reasoning range.",
    displayName: 'GPT-5.6 Sol',
    enabled: true,
    id: 'gpt-5.6-sol',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Terra is the mid-tier GPT-5.6 model for coding, professional work, and agentic workflows.',
    displayName: 'GPT-5.6 Terra',
    enabled: true,
    id: 'gpt-5.6-terra',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Luna is the low-cost GPT-5.6 tier for high-volume tasks, classification, and sub-agents.',
    displayName: 'GPT-5.6 Luna',
    enabled: true,
    id: 'gpt-5.6-luna',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.5 is OpenAI's frontier model for complex professional work, coding, and agentic workflows with an expanded context window.",
    displayName: 'GPT-5.5',
    enabled: true,
    id: 'gpt-5.5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-23',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.5 Pro is the premium GPT-5.5 tier for the hardest professional and agentic work.',
    displayName: 'GPT-5.5 Pro',
    id: 'gpt-5.5-pro',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 180, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-23',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 is a highly capable GPT model for reasoning, instruction following, and multimodal understanding.',
    displayName: 'GPT-5.4',
    enabled: true,
    id: 'gpt-5.4',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-01',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 Pro is the premium GPT-5.4 tier for complex reasoning, coding, and multimodal tasks.',
    displayName: 'GPT-5.4 Pro',
    id: 'gpt-5.4-pro',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 180, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-05',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 mini balances speed and cost for well-defined coding, extraction, and agent tasks.',
    displayName: 'GPT-5.4 mini',
    enabled: true,
    id: 'gpt-5.4-mini',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-17',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: { ...gpt56Abilities },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 nano is the cheapest GPT-5.4-class model for classification, ranking, and high-volume sub-agents.',
    displayName: 'GPT-5.4 nano',
    enabled: true,
    id: 'gpt-5.4-nano',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-17',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 achieves further improvements in accuracy, speed, and reasoning for coding and agentic tasks.',
    displayName: 'GPT-5.2',
    enabled: true,
    id: 'gpt-5.2',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-15',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 Pro uses more computation to think deeper and consistently delivers better answers.',
    displayName: 'GPT-5.2 Pro',
    id: 'gpt-5.2-pro',
    maxOutput: 272_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 168, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-15',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description: 'GPT-5.3 Codex is optimized for agentic coding tasks.',
    displayName: 'GPT-5.3 Codex',
    id: 'gpt-5.3-codex',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-15',
    settings: { ...gpt56Settings },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT Audio 1.5 is the next-generation general audio chat model supporting audio I/O in the Chat Completions API.',
    displayName: 'GPT Audio 1.5',
    id: 'gpt-audio-1.5',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 64, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-15',
    type: 'chat',
  },
];

// Utility exception: OpenAI still lists text-embedding-3-* as the official embeddings API
// with no 2026 replacement. ChatHub Knowledge Base defaults to text-embedding-3-small.
export const openaiEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    contextWindowTokens: 8192,
    description:
      'Most capable OpenAI embedding model for English and multilingual retrieval. Utility exception: still the official embeddings API with no 2026 successor.',
    displayName: 'Text Embedding 3 Large',
    id: 'text-embedding-3-large',
    maxDimension: 3072,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2024-01-25',
    type: 'embedding',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Cost-efficient OpenAI embedding model for knowledge retrieval and RAG. Utility exception: still the official embeddings API with no 2026 successor (ChatHub default).',
    displayName: 'Text Embedding 3 Small',
    id: 'text-embedding-3-small',
    maxDimension: 1536,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2024-01-25',
    type: 'embedding',
  },
];

// Utility exception: OpenAI still lists these TTS ids with no 2026 TTS-only replacement.
export const openaiTTSModels: AITTSModelCard[] = [
  {
    description:
      'OpenAI TTS optimized for realtime latency. Utility exception: still the official TTS API with no 2026 successor.',
    displayName: 'TTS-1',
    id: 'tts-1',
    pricing: {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
  },
  {
    description:
      'OpenAI TTS optimized for quality. Utility exception: still the official TTS API with no 2026 successor.',
    displayName: 'TTS-1 HD',
    id: 'tts-1-hd',
    pricing: {
      units: [{ name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
  },
  {
    description:
      'GPT-4o mini TTS converts text to natural speech. Utility exception: still the official instruction-following TTS API with no 2026 successor.',
    displayName: 'GPT-4o Mini TTS',
    id: 'gpt-4o-mini-tts',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'tts',
  },
];

export const openaiSTTModels: AISTTModelCard[] = [
  {
    description:
      'Current official speech-to-text model for file, streamed, and Realtime transcription. Replaces whisper-1 / gpt-4o-transcribe.',
    displayName: 'GPT Transcribe',
    id: 'gpt-transcribe',
    pricing: {
      units: [
        {
          name: 'audioInput',
          rate: 0.000075, // $0.0045 per minute
          strategy: 'fixed',
          unit: 'second',
        },
      ],
    },
    type: 'stt',
  },
];

export const openaiImageModels: AIImageModelCard[] = [
  {
    description:
      'GPT Image 2 is the current Images API model, replacing gpt-image-1 with 2K/4K size presets.',
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    parameters: gptImage2CompatibleParamsSchema,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    resolutions: [...GPT_IMAGE_2_SIZE_PRESETS],
    type: 'image',
  },
  {
    description:
      'GPT Image 1.5 remains available until OpenAI’s 1 Dec 2026 shutdown of this id.',
    displayName: 'GPT Image 1.5',
    enabled: true,
    id: 'gpt-image-1.5',
    parameters: gptImage1ParamsSchema,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: {
            prices: {
              high_1024x1024: 0.17,
              high_1024x1536: 0.25,
              high_1536x1024: 0.25,
              low_1024x1024: 0.01,
              low_1024x1536: 0.015,
              low_1536x1024: 0.015,
              medium_1024x1024: 0.04,
              medium_1024x1536: 0.06,
              medium_1536x1024: 0.06,
            },
            pricingParams: ['quality', 'size'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    },
    releasedAt: '2026-02-01',
    resolutions: ['1024x1024', '1024x1536', '1536x1024'],
    type: 'image',
  },
];

export const openaiRealtimeModels: AIRealtimeModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-Realtime-2.1 is the current speech-to-speech reasoning model with tool use. Official model card omits a GA date; listed as current in 2026.',
    displayName: 'GPT Realtime 2.1',
    id: 'gpt-realtime-2.1',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'audioInput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 64, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'realtime',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Next-generation general realtime model supporting real-time text and audio input/output with image input support.',
    displayName: 'GPT Realtime 1.5',
    id: 'gpt-realtime-1.5',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 64, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-15',
    type: 'realtime',
  },
];

export const allModels = [
  ...openaiChatModels,
  ...openaiEmbeddingModels,
  ...openaiTTSModels,
  ...openaiSTTModels,
  ...openaiImageModels,
  ...openaiRealtimeModels,
];

export default allModels;
