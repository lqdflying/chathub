import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKnowledgeBaseStore } from '@/store/knowledgeBase';
import { useUserStore } from '@/store/user';

const mutateAccountSWRByPredicate = vi.hoisted(() => vi.fn());

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  mutateAccountSWRByPredicate,
}));

describe('RAG evaluation account refreshes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserStore.setState({
      ownershipInvalidationGeneration: 0,
      userStateInitializationFailure: undefined,
    });
  });

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
