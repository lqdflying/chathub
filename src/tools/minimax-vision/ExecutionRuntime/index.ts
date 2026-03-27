import { BuiltinServerRuntimeOutput } from '@lobechat/types';

export interface AnalyzeImageParams {
  imageUrl: string;
  prompt?: string;
}

const VISION_PROMPT =
  'Describe this image in detail. Include any text, charts, diagrams, or important visual elements.';

/**
 * Fetch an image and convert it to a base64 data URL.
 * Supports http(s) URLs and data URLs.
 */
const fetchImageAsDataUrl = async (imageUrl: string): Promise<string> => {
  if (imageUrl.trim().startsWith('data:')) {
    return imageUrl.trim();
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return `data:${contentType};base64,${buffer.toString('base64')}`;
};

export class MinimaxVisionExecutionRuntime {
  constructor(private options: { apiKey: string; baseUrl: string }) {}

  async analyzeImage(args: AnalyzeImageParams): Promise<BuiltinServerRuntimeOutput> {
    const { apiKey, baseUrl } = this.options;
    const prompt = args.prompt || VISION_PROMPT;

    try {
      const dataUrl = await fetchImageAsDataUrl(args.imageUrl);
      const url = `${baseUrl}/coding_plan/vlm`;

      const response = await fetch(url, {
        body: JSON.stringify({ image_url: dataUrl, prompt }),
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'MM-API-Source': 'LobeHub',
        },
        method: 'POST',
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          content: `Vision API error: ${response.status} ${response.statusText}\n${text}`,
          error: new Error(`Vision API error: ${response.status}`),
          success: false,
        };
      }

      const data = (await response.json()) as {
        base_resp?: { status_code?: number; status_msg?: string };
        content?: string;
      };

      const baseResp = data.base_resp;
      const apiCode = baseResp?.status_code;
      if (apiCode !== undefined && apiCode !== 0) {
        const msg = baseResp?.status_msg?.trim() || 'Unknown error';
        return {
          content: `Vision API error (${apiCode}): ${msg}`,
          error: new Error(`Vision API error (${apiCode}): ${msg}`),
          success: false,
        };
      }

      const content = data.content?.trim();
      if (!content) {
        return {
          content: 'Vision API returned empty content',
          error: new Error('Vision API returned empty content'),
          success: false,
        };
      }

      return { content, success: true };
    } catch (e) {
      const err = e as Error;
      return { content: err.message, error: err, success: false };
    }
  }
}
