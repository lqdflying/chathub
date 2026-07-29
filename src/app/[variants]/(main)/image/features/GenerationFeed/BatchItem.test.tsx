import { fireEvent, render, screen } from '@testing-library/react';
import React, { type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';
import type { GenerationBatch } from '@/types/generation';

import { GenerationBatchItem } from './BatchItem';

vi.stubGlobal('React', React);

const { imageStoreListeners, imageStoreState } = vi.hoisted(() => ({
  imageStoreListeners: new Set<() => void>(),
  imageStoreState: {
    activeGenerationTopicId: 'topic-1',
    recreateImage: vi.fn(async () => {}),
    regeneratingBatchIds: [] as string[],
    removeGenerationBatch: vi.fn(async () => {}),
    reuseSettings: vi.fn(),
  },
}));

const updateImageStoreState = (update: Partial<typeof imageStoreState>) => {
  Object.assign(imageStoreState, update);
  imageStoreListeners.forEach((listener) => listener());
};

vi.mock('@/store/image', async () => {
  const React = await import('react');

  return {
    useImageStore: <Selected,>(selector: (state: typeof imageStoreState) => Selected) =>
      React.useSyncExternalStore(
        (listener) => {
          imageStoreListeners.add(listener);
          return () => imageStoreListeners.delete(listener);
        },
        () => selector(imageStoreState),
        () => selector(imageStoreState),
      ),
  };
});

vi.mock('@formkit/auto-animate/react', () => ({
  useAutoAnimate: () => [{ current: null }],
}));

vi.mock('@lobehub/icons', () => ({
  ModelTag: ({ model }: { model: string }) => <span>{model}</span>,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIconGroup: ({
    items = [],
  }: {
    items?: Array<{
      disabled?: boolean;
      key?: React.Key;
      label?: React.ReactNode;
      loading?: boolean;
      onClick?: () => void;
    } | null>;
  }) => (
    <div>
      {items.map((item) =>
        item ? (
          <button
            aria-busy={item.loading}
            disabled={item.disabled}
            key={item.key}
            onClick={item.onClick}
            type="button"
          >
            {item.label}
          </button>
        ) : null,
      )}
    </div>
  ),
  Block: ({ children }: PropsWithChildren) => <section>{children}</section>,
  Grid: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Markdown: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Tag: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: vi.fn(),
        success: vi.fn(),
      },
    }),
  },
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      batchActions: 'batch-actions',
      batchDeleteButton: 'batch-delete-button',
      container: 'container',
      prompt: 'prompt',
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('@/components/InvalidAPIKey', () => ({
  default: () => <div>invalid-api-key</div>,
}));

vi.mock('./GenerationItem', () => ({
  GenerationItem: ({ generation }: { generation: { id: string } }) => (
    <div data-testid={`generation-${generation.id}`} />
  ),
}));

vi.mock('./ReferenceImages', () => ({
  ReferenceImages: () => null,
}));

const createGenerationBatch = (
  id: string,
  statuses: AsyncTaskStatus[],
): GenerationBatch => ({
  config: { prompt: 'Create a landscape' },
  createdAt: new Date('2026-07-29T00:00:00Z'),
  generations: statuses.map((status, index) => ({
    asyncTaskId: `async-task-${id}-${index}`,
    createdAt: new Date('2026-07-29T00:00:00Z'),
    id: `${id}-generation-${index}`,
    task: {
      id: `task-${id}-${index}`,
      status,
    },
  })),
  id,
  model: 'gpt-image-2',
  prompt: 'Create a landscape',
  provider: 'openai',
});

describe('GenerationBatchItem', () => {
  beforeEach(() => {
    updateImageStoreState({
      activeGenerationTopicId: 'topic-1',
      recreateImage: vi.fn(async () => {}),
      regeneratingBatchIds: [],
      removeGenerationBatch: vi.fn(async () => {}),
      reuseSettings: vi.fn(),
    });
  });

  it('does not show Regenerate when every output succeeded', () => {
    render(
      <GenerationBatchItem
        batch={createGenerationBatch('successful-batch', [AsyncTaskStatus.Success])}
      />,
    );

    expect(screen.queryByRole('button', { name: 'generation.actions.regenerate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'generation.actions.reuseSettings' })).toBeTruthy();
  });

  it('shows Regenerate before Reuse Settings for a mixed batch', () => {
    render(
      <GenerationBatchItem
        batch={createGenerationBatch('mixed-batch', [
          AsyncTaskStatus.Success,
          AsyncTaskStatus.Error,
        ])}
      />,
    );

    const actionButtons = screen.getAllByRole('button');
    expect(actionButtons[0].textContent).toBe('generation.actions.regenerate');
    expect(actionButtons[1].textContent).toBe('generation.actions.reuseSettings');
  });

  it('regenerates the failed batch when selected', () => {
    render(
      <GenerationBatchItem
        batch={createGenerationBatch('failed-batch', [
          AsyncTaskStatus.Error,
          AsyncTaskStatus.Error,
        ])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'generation.actions.regenerate' }));

    expect(imageStoreState.recreateImage).toHaveBeenCalledOnce();
    expect(imageStoreState.recreateImage).toHaveBeenCalledWith('failed-batch');
  });

  it('shows progress only for the batch currently regenerating', () => {
    updateImageStoreState({ regeneratingBatchIds: ['active-batch'] });

    render(
      <>
        <GenerationBatchItem
          batch={createGenerationBatch('active-batch', [AsyncTaskStatus.Error])}
        />
        <GenerationBatchItem
          batch={createGenerationBatch('idle-batch', [AsyncTaskStatus.Error])}
        />
      </>,
    );

    const activeButton = screen.getByRole('button', {
      name: 'generation.actions.regenerating',
    });
    const idleButton = screen.getByRole('button', {
      name: 'generation.actions.regenerate',
    });

    expect((activeButton as HTMLButtonElement).disabled).toBe(true);
    expect(activeButton.getAttribute('aria-busy')).toBe('true');
    expect((idleButton as HTMLButtonElement).disabled).toBe(false);
    expect(idleButton.getAttribute('aria-busy')).toBe('false');
  });
});
