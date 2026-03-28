import { BuiltinToolManifest } from '@lobechat/types';

export const MinimaxVisionApiName = {
  analyzeImage: 'analyzeImage',
} as const;

export const MinimaxVisionManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Analyze an image and return a description. To save time and get a focused answer, always pass the user's specific question into the `prompt` parameter instead of asking for a generic detailed description.",
      name: MinimaxVisionApiName.analyzeImage,
      parameters: {
        properties: {
          imageUrl: {
            description:
              'The URL or data URL of the image to analyze. Can be a base64 data URL (data:image/...;base64,...) or a direct image URL.',
            type: 'string',
          },
          prompt: {
            description:
              'The specific question or instruction about the image. Pass the exact question from the user for faster, targeted analysis (e.g. "What is the text in the red box?"). If not specified, the API will generate a slow, full detailed description.',
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
  systemRole: `You are a vision analysis assistant. When given an image URL, call the analyzeImage tool to gather information from the image. 
CRITICAL: For faster response, always pass a specific, focused query into the 'prompt' parameter of the tool based on what the user wants to know, rather than leaving it empty. Do not ask for full descriptions unless explicitly requested. Return the gathered information to the user in a clear, structured way.`,
  type: 'builtin',
};
