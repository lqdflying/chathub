import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ragEvalService } from '@/services/ragEval';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';
import { useUserStore } from '@/store/user';

const mutateAccountSWRByPredicate = vi.hoisted(() => vi.fn());

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  mutateAccountSWRByPredicate,
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('RAG evaluation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserStore.setState({
      ownershipInvalidationGeneration: 0,
      userStateInitializationFailure: undefined,
    });
    useKnowledgeBaseStore.setState({
      activeKnowledgeBaseId: 'knowledge-base-id',
      initDatasetList: false,
      scopeGeneration: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('account mutation quarantine', () => {
    it('blocks every dataset mutation during a same-scope owner mismatch', async () => {
      const createDataset = vi.spyOn(ragEvalService, 'createDataset');
      const importDatasetRecords = vi.spyOn(ragEvalService, 'importDatasetRecords');
      const removeDataset = vi.spyOn(ragEvalService, 'removeDataset');
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });
      const file = new File(
        [JSON.stringify({ question: 'What is RAG?' })],
        'dataset.jsonl',
        { type: 'application/jsonl' },
      );

      const store = useKnowledgeBaseStore.getState();
      await store.createNewDataset({
        knowledgeBaseId: 'knowledge-base-id',
        name: 'Blocked dataset',
      });
      await store.importDataset(file, 1);
      await store.removeDataset(1);

      expect(createDataset).not.toHaveBeenCalled();
      expect(importDatasetRecords).not.toHaveBeenCalled();
      expect(removeDataset).not.toHaveBeenCalled();
    });

    it('blocks every evaluation mutation during a same-scope owner mismatch', async () => {
      const checkEvaluationStatus = vi.spyOn(ragEvalService, 'checkEvaluationStatus');
      const createEvaluation = vi.spyOn(ragEvalService, 'createEvaluation');
      const removeEvaluation = vi.spyOn(ragEvalService, 'removeEvaluation');
      const startEvaluationTask = vi.spyOn(ragEvalService, 'startEvaluationTask');
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      const store = useKnowledgeBaseStore.getState();
      await store.checkEvaluationStatus(1);
      await store.createNewEvaluation({
        datasetId: 1,
        knowledgeBaseId: 'knowledge-base-id',
        name: 'Blocked evaluation',
      });
      await store.removeEvaluation(1);
      await store.runEvaluation(1);

      expect(checkEvaluationStatus).not.toHaveBeenCalled();
      expect(createEvaluation).not.toHaveBeenCalled();
      expect(removeEvaluation).not.toHaveBeenCalled();
      expect(startEvaluationTask).not.toHaveBeenCalled();
    });

    it('refreshes only the explicit dataset list after active selection changes', async () => {
      const datasetCreated = createDeferred<number | undefined>();
      vi.spyOn(ragEvalService, 'createDataset').mockReturnValue(datasetCreated.promise);
      let creationPromise!: Promise<void>;

      act(() => {
        creationPromise = useKnowledgeBaseStore.getState().createNewDataset({
          knowledgeBaseId: 'knowledge-base-id',
          name: 'Stale dataset',
        });
      });
      await waitFor(() => {
        expect(ragEvalService.createDataset).toHaveBeenCalled();
      });

      act(() => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'replacement-kb' });
      });
      datasetCreated.resolve(1);
      await act(async () => {
        await creationPromise;
      });

      expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(1);
      const [requestedScope, predicate] = mutateAccountSWRByPredicate.mock.calls[0];
      expect(requestedScope).toBe('local');
      expect(predicate(['FETCH_DATASET_LIST', 'local', 'knowledge-base-id'])).toBe(true);
      expect(predicate(['FETCH_DATASET_LIST', 'local', 'replacement-kb'])).toBe(false);
    });

    it('refreshes only the explicit evaluation list after active selection changes', async () => {
      const evaluationCreated = createDeferred<number | undefined>();
      vi.spyOn(ragEvalService, 'createEvaluation').mockReturnValue(evaluationCreated.promise);
      let creationPromise!: Promise<void>;

      act(() => {
        creationPromise = useKnowledgeBaseStore.getState().createNewEvaluation({
          datasetId: 1,
          knowledgeBaseId: 'knowledge-base-id',
          name: 'Stale evaluation',
        });
      });
      await waitFor(() => {
        expect(ragEvalService.createEvaluation).toHaveBeenCalled();
      });

      act(() => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId: 'replacement-kb' });
      });
      evaluationCreated.resolve(1);
      await act(async () => {
        await creationPromise;
      });

      expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(1);
      const [requestedScope, predicate] = mutateAccountSWRByPredicate.mock.calls[0];
      expect(requestedScope).toBe('local');
      expect(predicate(['FETCH_EVALUATION_LIST_KEY', 'local', 'knowledge-base-id'])).toBe(
        true,
      );
      expect(predicate(['FETCH_EVALUATION_LIST_KEY', 'local', 'replacement-kb'])).toBe(
        false,
      );
    });
  });

  describe('explicit mutation targets', () => {
    it.each([null, 'unrelated-kb'])(
      'runs ID-only RAG actions when active knowledge base is %s',
      async (activeKnowledgeBaseId) => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId });
        const importDatasetRecords = vi
          .spyOn(ragEvalService, 'importDatasetRecords')
          .mockResolvedValue();
        const removeDataset = vi.spyOn(ragEvalService, 'removeDataset').mockResolvedValue();
        const checkEvaluationStatus = vi
          .spyOn(ragEvalService, 'checkEvaluationStatus')
          .mockResolvedValue({ success: true });
        const removeEvaluation = vi
          .spyOn(ragEvalService, 'removeEvaluation')
          .mockResolvedValue();
        const startEvaluationTask = vi
          .spyOn(ragEvalService, 'startEvaluationTask')
          .mockResolvedValue(undefined as any);
        const file = new File(
          [JSON.stringify({ question: 'What is RAG?' })],
          'dataset.jsonl',
          { type: 'application/jsonl' },
        );

        const store = useKnowledgeBaseStore.getState();
        await store.importDataset(file, 1);
        await store.removeDataset(1);
        await store.checkEvaluationStatus(1);
        await store.removeEvaluation(1);
        await store.runEvaluation(1);

        expect(importDatasetRecords).toHaveBeenCalledWith(1, file, {
          isContinuationCurrent: expect.any(Function),
        });
        expect(removeDataset).toHaveBeenCalledWith(1);
        expect(checkEvaluationStatus).toHaveBeenCalledWith(1);
        expect(removeEvaluation).toHaveBeenCalledWith(1);
        expect(startEvaluationTask).toHaveBeenCalledWith(1);
      },
    );

    it.each([null, 'unrelated-kb'])(
      'binds RAG creation to explicit knowledge base when active is %s',
      async (activeKnowledgeBaseId) => {
        useKnowledgeBaseStore.setState({ activeKnowledgeBaseId });
        const createDataset = vi.spyOn(ragEvalService, 'createDataset').mockResolvedValue(1);
        const createEvaluation = vi
          .spyOn(ragEvalService, 'createEvaluation')
          .mockResolvedValue(1);

        const store = useKnowledgeBaseStore.getState();
        await store.createNewDataset({
          knowledgeBaseId: 'target-kb',
          name: 'Target dataset',
        });
        await store.createNewEvaluation({
          datasetId: 1,
          knowledgeBaseId: 'target-kb',
          name: 'Target evaluation',
        });

        expect(createDataset).toHaveBeenCalledWith({
          knowledgeBaseId: 'target-kb',
          name: 'Target dataset',
        });
        expect(createEvaluation).toHaveBeenCalledWith({
          datasetId: 1,
          knowledgeBaseId: 'target-kb',
          name: 'Target evaluation',
        });
        expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(2);
        const datasetPredicate = mutateAccountSWRByPredicate.mock.calls[0][1];
        const evaluationPredicate = mutateAccountSWRByPredicate.mock.calls[1][1];
        expect(datasetPredicate(['FETCH_DATASET_LIST', 'local', 'target-kb'])).toBe(true);
        expect(datasetPredicate(['FETCH_DATASET_LIST', 'local', 'unrelated-kb'])).toBe(false);
        expect(evaluationPredicate(['FETCH_EVALUATION_LIST_KEY', 'local', 'target-kb'])).toBe(
          true,
        );
        expect(
          evaluationPredicate(['FETCH_EVALUATION_LIST_KEY', 'local', 'unrelated-kb']),
        ).toBe(false);
      },
    );
  });

  describe('account refreshes', () => {
    it('refreshes dataset lists through the account predicate boundary', async () => {
      await act(async () => {
        await useKnowledgeBaseStore.getState().refreshDatasetList();
      });

      expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(1);
      const [requestedScope, predicate] = mutateAccountSWRByPredicate.mock.calls[0];
      expect(requestedScope).toBe('local');
      expect(predicate(['FETCH_DATASET_LIST', 'local', 'knowledge-base-id'])).toBe(true);
      expect(predicate(['FETCH_EVALUATION_LIST_KEY', 'local', 'knowledge-base-id'])).toBe(false);
    });

    it('refreshes evaluation lists through the account predicate boundary', async () => {
      await act(async () => {
        await useKnowledgeBaseStore.getState().refreshEvaluationList();
      });

      expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(1);
      const [requestedScope, predicate] = mutateAccountSWRByPredicate.mock.calls[0];
      expect(requestedScope).toBe('local');
      expect(predicate(['FETCH_EVALUATION_LIST_KEY', 'local', 'knowledge-base-id'])).toBe(true);
      expect(predicate(['FETCH_DATASET_LIST', 'local', 'knowledge-base-id'])).toBe(false);
    });
  });
});
