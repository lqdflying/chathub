import { BuiltinToolManifest } from '@lobechat/types';

export const MinimaxVisionApiName = {
  analyzeImage: 'analyzeImage',
} as const;

export const MinimaxVisionManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Analyze an image and return a detailed description of its content, including any text, charts, diagrams, or important visual elements. Use this tool when you need to understand or describe what is shown in an image.',
      name: MinimaxVisionApiName.analyzeImage,
      parameters: {
        properties: {
          imageUrl: {
            description:
              'The URL or data URL of the image to analyze. Can be a base64 data URL (data:image/...;base64,...) or a direct image URL.',
            type: 'string',
          },
          prompt: {
            default:
              'Describe this image in detail. Include any text, charts, diagrams, or important visual elements.',
            description:
              'The prompt to guide the image analysis. Defaults to a standard description request.',
            type: 'string',
          },
        },
        required: ['imageUrl'],
        type: 'object',
      },
    },
  ],
  identifier: 'lobe-minimax-vision',
  meta: {
    avatar: '🖼️',
    title: 'MiniMax Vision',
  },
  systemRole: `You are a vision analysis assistant. When given an image URL, call the analyzeImage tool to get a detailed description of the image content. Return the description to the user in a clear, structured way.`,
  type: 'builtin',
};
