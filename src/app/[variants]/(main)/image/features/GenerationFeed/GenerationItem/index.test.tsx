import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation, GenerationBatch } from '@/types/generation';

import { GenerationItem } from './index';

vi.stubGlobal('React', React);

const imageStoreState = vi.hoisted(() => ({
  activeGenerationTopicId: 'topic-1',
  removeGeneration: vi.fn(),
  reuseSeed: vi.fn(),
  useCheckGenerationStatus: vi.fn(),
}));

vi.mock('@/store/image', () => ({
  useImageStore: (selector: (state: typeof imageStoreState) => unknown) =>
    selector(imageStoreState),
}));

vi.mock('@/store/image/selectors', () => ({
  imageGenerationConfigSelectors: {
    isSupportedParam: () => () => false,
  },
}));

vi.mock('@/hooks/useDownloadImage', () => ({
  useDownloadImage: () => ({ downloadImage: vi.fn() }),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: vi.fn(), success: vi.fn() } }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./ErrorState', () => ({
  ErrorState: () => <div>Error generation</div>,
}));

vi.mock('./LoadingState', () => ({
  LoadingState: () => <div>Pending generation</div>,
}));

vi.mock('./SuccessState', () => ({
  SuccessState: () => <div>Completed generation</div>,
}));

vi.mock('./utils', () => ({
  getAspectRatio: () => '1 / 1',
}));

const generationBatch = {
  config: { prompt: 'Create a cat' },
  createdAt: new Date('2026-08-03T00:00:00Z'),
  generations: [],
  id: 'batch-1',
  model: 'gpt-image-2',
  prompt: 'Create a cat',
  provider: 'openai',
} as GenerationBatch;

const createGeneration = (status: AsyncTaskStatus): Generation =>
  ({
    asyncTaskId: 'task-1',
    createdAt: new Date('2026-08-03T00:00:00Z'),
    id: 'generation-1',
    task: { id: 'task-1', status },
  }) as Generation;

describe('GenerationItem status polling', () => {
  beforeEach(() => {
    imageStoreState.activeGenerationTopicId = 'topic-1';
    imageStoreState.useCheckGenerationStatus.mockReset();
  });

  it('polls a pending generation for the active mobile topic', () => {
    render(
      <GenerationItem
        generation={createGeneration(AsyncTaskStatus.Pending)}
        generationBatch={generationBatch}
        prompt="Create a cat"
      />,
    );

    expect(screen.getByText('Pending generation')).toBeTruthy();
    expect(imageStoreState.useCheckGenerationStatus).toHaveBeenCalledWith(
      'generation-1',
      'task-1',
      'topic-1',
      true,
    );
  });

  it('disables polling after a generation is finalized', () => {
    render(
      <GenerationItem
        generation={createGeneration(AsyncTaskStatus.Error)}
        generationBatch={generationBatch}
        prompt="Create a cat"
      />,
    );

    expect(screen.getByText('Error generation')).toBeTruthy();
    expect(imageStoreState.useCheckGenerationStatus).toHaveBeenCalledWith(
      'generation-1',
      'task-1',
      'topic-1',
      false,
    );
  });
});
