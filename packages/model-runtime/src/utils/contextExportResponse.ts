import type { ContextExportJsonValue, ContextExportRequestSnapshot } from '@lobechat/types';

const encodeContextSnapshotEvent = (snapshot: ContextExportRequestSnapshot) => {
  const encoder = new TextEncoder();
  return encoder.encode(`event: context_snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
};

export interface ContextExportCaptureBridge {
  getSnapshot: () =>
    | {
        apiMode?: string;
        providerRequest: ContextExportJsonValue;
      }
    | undefined;
  onRequestPrepared: (request: unknown, metadata?: { apiMode?: string }) => void;
  snapshot: Promise<{
    apiMode?: string;
    providerRequest: ContextExportJsonValue;
  }>;
}

export const createContextExportCaptureBridge = (
  sanitize: (value: unknown) => ContextExportJsonValue,
): ContextExportCaptureBridge => {
  let resolveSnapshot:
    | ((snapshot: { apiMode?: string; providerRequest: ContextExportJsonValue }) => void)
    | undefined;
  let capturedSnapshot:
    | {
        apiMode?: string;
        providerRequest: ContextExportJsonValue;
      }
    | undefined;
  let resolved = false;

  const snapshot = new Promise<{
    apiMode?: string;
    providerRequest: ContextExportJsonValue;
  }>((resolve) => {
    resolveSnapshot = resolve;
  });

  return {
    getSnapshot: () => capturedSnapshot,
    onRequestPrepared: (request, metadata) => {
      if (resolved) return;
      resolved = true;
      capturedSnapshot = {
        apiMode: metadata?.apiMode,
        providerRequest: sanitize(request),
      };
      resolveSnapshot?.(capturedSnapshot);
    },
    snapshot,
  };
};

export const prependContextSnapshotToResponse = (
  response: Response,
  snapshotPromise: Promise<ContextExportRequestSnapshot>,
): Response => {
  if (!response.body) return response;

  const body = response.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let snapshotEnqueued = false;

  const stream = new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader?.cancel(reason);
    },
    async pull(controller) {
      reader ??= body.getReader();

      try {
        const pendingChunk = reader.read();
        if (!snapshotEnqueued) {
          const firstResult = await Promise.race([
            snapshotPromise.then((snapshot) => ({ snapshot })),
            pendingChunk.then(
              (streamResult) => ({ streamResult }),
              (error) => ({ error }),
            ),
          ]);

          if ('error' in firstResult) throw firstResult.error;

          if ('streamResult' in firstResult && firstResult.streamResult.done) {
            controller.close();
            return;
          }

          const snapshot =
            'snapshot' in firstResult ? firstResult.snapshot : await snapshotPromise;
          snapshotEnqueued = true;
          controller.enqueue(encodeContextSnapshotEvent(snapshot));
        }

        const { done, value } = await pendingChunk;
        if (done) {
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};
