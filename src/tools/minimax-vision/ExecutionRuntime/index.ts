import { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client/tools';

export interface AnalyzeImageParams {
  imageUrl: string;
  prompt?: string;
}

export class MinimaxVisionExecutionRuntime {
  constructor() {
    // API key and baseUrl are read server-side from env vars
    // via the tools.minimaxVision tRPC endpoint
  }

  async analyzeImage(args: AnalyzeImageParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await toolsClient.minimaxVision.analyze.mutate({
        imageUrl: args.imageUrl,
        prompt: args.prompt,
      });

      if (result.success && result.content) {
        return { content: result.content, success: true };
      }

      return {
        content: result.error || 'Vision analysis failed',
        error: new Error(result.error || 'Vision analysis failed'),
        success: false,
      };
    } catch (e) {
      const err = e as Error;
      return { content: err.message, error: err, success: false };
    }
  }
}
