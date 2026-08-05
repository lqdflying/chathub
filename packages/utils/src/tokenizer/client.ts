const TOKENIZER_WORKER_TIMEOUT_MS = 3000;

interface PendingTokenizerRequest {
  reject: (error: Error) => void;
  resolve: (tokens: number) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface TokenizerWorkerResponse {
  error?: unknown;
  id?: unknown;
  result?: unknown;
}

let worker: Worker | null = null;
let requestSequence = 0;
const pendingRequests = new Map<string, PendingTokenizerRequest>();

const createRequestId = () =>
  `tokenizer_${Date.now().toString(36)}_${(++requestSequence).toString(36)}`;

const normalizeError = (error: unknown, fallbackMessage: string) =>
  error instanceof Error ? error : new Error(fallbackMessage);

const settleRequest = (id: string, settle: (request: PendingTokenizerRequest) => void): boolean => {
  const request = pendingRequests.get(id);
  if (!request) return false;

  clearTimeout(request.timeout);
  pendingRequests.delete(id);
  settle(request);
  return true;
};

const rejectPendingRequests = (error: Error) => {
  for (const id of [...pendingRequests.keys()]) {
    settleRequest(id, ({ reject }) => reject(error));
  }
};

const handleMessage = (event: MessageEvent<TokenizerWorkerResponse>) => {
  const { error, id, result } = event.data || {};
  if (typeof id !== 'string') return;

  if (error !== undefined) {
    const message = typeof error === 'string' ? error : 'Tokenizer worker failed';
    settleRequest(id, ({ reject }) => reject(new Error(message)));
    return;
  }

  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) {
    settleRequest(id, ({ reject }) =>
      reject(new Error('Tokenizer worker returned an invalid response')),
    );
    return;
  }

  settleRequest(id, ({ resolve }) => resolve(result));
};

const removeWorkerListeners = (target: Worker) => {
  target.removeEventListener('message', handleMessage);
  target.removeEventListener('error', handleWorkerError);
  target.removeEventListener('messageerror', handleWorkerMessageError);
};

const resetWorker = (error: Error) => {
  const currentWorker = worker;
  worker = null;

  if (currentWorker) {
    removeWorkerListeners(currentWorker);
    currentWorker.terminate();
  }

  rejectPendingRequests(error);
};

function handleWorkerError(event: ErrorEvent) {
  resetWorker(normalizeError(event.error, 'Tokenizer worker failed'));
}

function handleWorkerMessageError() {
  resetWorker(new Error('Tokenizer worker response could not be decoded'));
}

const getWorker = () => {
  if (worker || typeof Worker === 'undefined') return worker;

  const nextWorker = new Worker(new URL('tokenizer.worker.ts', import.meta.url));
  try {
    nextWorker.addEventListener('message', handleMessage);
    nextWorker.addEventListener('error', handleWorkerError);
    nextWorker.addEventListener('messageerror', handleWorkerMessageError);
  } catch (error) {
    nextWorker.terminate();
    throw error;
  }

  worker = nextWorker;
  return worker;
};

export const clientEncodeAsync = (str: string): Promise<number> =>
  new Promise((resolve, reject) => {
    let activeWorker: Worker | null;
    try {
      activeWorker = getWorker();
    } catch (error) {
      reject(normalizeError(error, 'Tokenizer worker could not be created'));
      return;
    }

    if (!activeWorker) {
      // Preserve the existing non-Worker fallback for generic encodeAsync callers.
      resolve(str.length);
      return;
    }

    const id = createRequestId();
    const timeout = setTimeout(() => {
      resetWorker(new Error('Tokenizer worker timed out'));
    }, TOKENIZER_WORKER_TIMEOUT_MS);

    pendingRequests.set(id, { reject, resolve, timeout });

    try {
      activeWorker.postMessage({ id, str });
    } catch (error) {
      resetWorker(normalizeError(error, 'Tokenizer worker request failed'));
    }
  });
