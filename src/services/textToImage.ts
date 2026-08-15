import { CreateImagePayload, CreateImageResponse } from '@lobechat/model-runtime';

import { createHeaderWithAuth } from '@/services/_auth';

import { API_ENDPOINTS } from './_url';

interface FetchOptions {
  signal?: AbortSignal | undefined;
}

class ImageGenerationService {
  /**
   * Generate an image through the modern, provider-agnostic `createImage` runtime
   * path so the built-in Image tool uses whatever image model/provider the user
   * has configured (the same primitive as the main Image workspace).
   */
  createImage = async (
    { provider, model, params }: CreateImagePayload & { provider: string },
    options?: FetchOptions,
  ): Promise<CreateImageResponse> => {
    const headers = await createHeaderWithAuth({
      headers: { 'Content-Type': 'application/json' },
      provider,
    });

    const res = await fetch(API_ENDPOINTS.createImage(provider), {
      body: JSON.stringify({ model, params } satisfies CreateImagePayload),
      headers,
      method: 'POST',
      signal: options?.signal,
    });

    if (!res.ok) {
      // The error body may be JSON (backend error payload) or plain text/HTML
      // (proxy/gateway failures). Parse defensively so the caller never has to
      // deal with a SyntaxError from res.json().
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      throw parsed ?? new Error(text || `Image generation failed with status ${res.status}`);
    }

    return res.json();
  };
}

export const imageGenerationService = new ImageGenerationService();
