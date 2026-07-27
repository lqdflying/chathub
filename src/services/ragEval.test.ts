import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { ragEvalService } from '@/services/ragEval';
import { uploadService } from '@/services/upload';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    ragEval: {
      importDatasetRecords: {
        mutate: vi.fn(),
      },
    },
  },
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('ragEvalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops dataset import after upload when the originating checkpoint is invalid', async () => {
    const uploadFinished = createDeferred<{ path: string }>();
    vi.spyOn(uploadService, 'uploadToServerS3').mockReturnValue(uploadFinished.promise as any);
    let isContinuationCurrent = true;
    const file = new File(['{"question":"What is RAG?"}'], 'dataset.jsonl', {
      type: 'application/jsonl',
    });

    const importPromise = ragEvalService.importDatasetRecords(7, file, {
      isContinuationCurrent: () => isContinuationCurrent,
    });
    expect(uploadService.uploadToServerS3).toHaveBeenCalledWith(file, {
      directory: 'ragEval',
    });

    isContinuationCurrent = false;
    uploadFinished.resolve({ path: 'ragEval/dataset.jsonl' });
    await importPromise;

    expect(lambdaClient.ragEval.importDatasetRecords.mutate).not.toHaveBeenCalled();
  });
});
