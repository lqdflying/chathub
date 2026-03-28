const VISION_PROMPT =
  'Please provide a brief and concise description of the main subjects in this image.';

/**
 * Fetch an image and convert it to a base64 data URL.
 * Runs server-side (no CORS issues).
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

export interface MinimaxVisionResult {
  content?: string;
  error?: string;
  success: boolean;
}

export const minimaxVisionService = {
  async analyzeImage(imageUrl: string, prompt?: string): Promise<MinimaxVisionResult> {
    const apiKey = process.env.MINIMAX_API_KEY;
    const baseURL = process.env.MINIMAX_API_BASE_URL || 'https://api.minimax.io/v1';

    if (!apiKey) {
      return { error: 'MiniMax API key not configured on server', success: false };
    }

    try {
      const dataUrl = await fetchImageAsDataUrl(imageUrl);
      const url = `${baseURL}/coding_plan/vlm`;

      const response = await fetch(url, {
        body: JSON.stringify({ image_url: dataUrl, prompt: prompt || VISION_PROMPT }),
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
          error: `Vision API error: ${response.status} ${response.statusText}\n${text}`,
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
        return { error: `Vision API error (${apiCode}): ${msg}`, success: false };
      }

      const content = data.content?.trim();
      if (!content) {
        return { error: 'Vision API returned empty content', success: false };
      }

      return { content, success: true };
    } catch (e) {
      const err = e as Error;
      return { error: err.message || 'Unknown error during vision analysis', success: false };
    }
  },
};
