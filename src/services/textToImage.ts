import { lambdaClient } from '@/libs/trpc/client';
import { createHeaderWithAuth } from '@/services/_auth';

import { API_ENDPOINTS } from './_url';

interface FetchOptions {
  signal?: AbortSignal | undefined;
}

export interface ChatImageTaskResult {
  error?: { body?: { detail?: string }; name?: string } | null;
  file?: { height?: number; id: string; width?: number };
  status: string;
}

class ImageGenerationService {
  /**
   * Start an in-chat image generation as an ASYNC TASK (the same pattern the
   * Image workspace uses) and return its task id. Generation can take 30–60 s;
   * a synchronous request held open that long dies at proxies/CDNs, so the
   * caller polls `getChatImageResult` instead. This creation request goes
   * through the dedicated webapi route because its auth payload must carry the
   * IMAGE provider's keyVaults (`createHeaderWithAuth(provider)`).
   */
  createChatImageTask = async (
    { provider, model, params }: { model: string; params: { prompt: string }; provider: string },
    options?: FetchOptions,
  ): Promise<{ taskId: string }> => {
    const headers = await createHeaderWithAuth({
      headers: { 'Content-Type': 'application/json' },
      provider,
    });

    const res = await fetch(API_ENDPOINTS.createChatImage(provider), {
      body: JSON.stringify({ model, params }),
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

    // validate the contract BEFORE anyone starts polling with it — a
    // wrong-shaped 200 (e.g. a route returning an image payload) must fail
    // here with a clear message, not as five minutes of doomed polls
    const data = (await res.json()) as { taskId?: unknown };
    if (typeof data.taskId !== 'string' || data.taskId.length === 0) {
      throw new Error(
        `Image task creation returned an invalid response (expected { taskId }): ${JSON.stringify(
          data,
        ).slice(0, 200)}`,
      );
    }
    return { taskId: data.taskId };
  };

  /**
   * Poll the outcome of a chat image task: status/error, and on success the
   * durable file the server created (id + dimensions). Polls run with global
   * error notifications suppressed — the per-item error card is the single
   * user-facing failure surface, and a failing poll loop must not spam the
   * global login/fetch UI every 2.5 s.
   */
  getChatImageResult = async (taskId: string): Promise<ChatImageTaskResult> => {
    return lambdaClient.image.getChatImageResult.query(
      { taskId },
      { context: { showNotification: false } },
    ) as Promise<ChatImageTaskResult>;
  };
}

export const imageGenerationService = new ImageGenerationService();
