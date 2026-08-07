import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';

import ChunkList from '.';

const mocks = vi.hoisted(() => ({
  getAllByFileId: vi.fn(),
  parseFilesToChunks: vi.fn(),
  refetch: vi.fn(),
  storeState: {
    chunkingStatus: undefined as AsyncTaskStatus | undefined,
    creatingChunkingTaskIds: [] as string[],
    fileList: [{ chunkingStatus: undefined, id: 'file-1' }],
  },
  subscribers: new Set<() => void>(),
}));

const notifyStoreSubscribers = () => {
  act(() => {
    mocks.subscribers.forEach((subscriber) => subscriber());
  });
};

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: React.PropsWithChildren<{
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }>) => (
    <button disabled={disabled} onClick={onClick} type={'button'}>
      {loading ? 'loading:' : ''}
      {children}
    </button>
  ),
  Empty: ({ children, description }: React.PropsWithChildren<{ description: React.ReactNode }>) => (
    <div data-testid={'chunk-empty'}>
      <div>{description}</div>
      {children}
    </div>
  ),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Flexbox: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('@/features/ChunkPager', () => ({
  default: ({
    chunks,
    onPageChange,
  }: {
    chunks: Array<{ id: string; text: string }>;
    onPageChange?: (page: number) => void;
  }) => (
    <div data-testid={'chunk-pager'}>
      <div data-testid={'chunk-page-text'}>{chunks[0]?.text}</div>
      {chunks.length > 1 && (
        <button onClick={() => onPageChange?.(2)} type={'button'}>
          next page
        </button>
      )}
    </div>
  ),
}));

vi.mock('./ChunkItem', () => ({
  default: ({ index, text, type }: { index: number; text: string; type: string | null }) => (
    <div data-testid={'chunk-header'}>{`${index}:${type}:${text}`}</div>
  ),
}));

vi.mock('../Loading', () => ({ default: () => <div data-testid={'chunk-loading'} /> }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    chunk: {
      getAllByFileId: {
        useQuery: mocks.getAllByFileId,
      },
    },
  },
}));

vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    getFileById: (id: string) => (state: typeof mocks.storeState) =>
      state.fileList.find((file) => file.id === id),
    isCreatingFileParseTask: (id: string) => (state: typeof mocks.storeState) =>
      state.creatingChunkingTaskIds.includes(id),
  },
  useFileStore: (
    selector: (
      state: typeof mocks.storeState & { parseFilesToChunks: typeof mocks.parseFilesToChunks },
    ) => unknown,
  ) => {
    const [, forceRender] = React.useState(0);

    React.useEffect(() => {
      const subscriber = () => {
        forceRender((renderCount) => renderCount + 1);
      };
      mocks.subscribers.add(subscriber);
      return () => {
        mocks.subscribers.delete(subscriber);
      };
    }, []);

    return selector({ ...mocks.storeState, parseFilesToChunks: mocks.parseFilesToChunks });
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ChunkList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribers.clear();
    mocks.storeState.chunkingStatus = undefined;
    mocks.storeState.creatingChunkingTaskIds = [];
    mocks.storeState.fileList = [{ chunkingStatus: undefined, id: 'file-1' }];
    mocks.getAllByFileId.mockReturnValue({
      data: [
        {
          id: 'chunk-1',
          index: 0,
          metadata: { converted_by: 'markitdown' },
          text: '# First chunk',
          type: 'MarkItDownElement',
        },
        {
          id: 'chunk-2',
          index: 1,
          metadata: null,
          text: '# Second chunk',
          type: 'LangChainElement',
        },
      ],
      isLoading: false,
      refetch: mocks.refetch,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads all file chunks once and updates the provenance header for the selected page', () => {
    render(<ChunkList fileId={'file-1'} />);

    expect(mocks.getAllByFileId).toHaveBeenCalledWith(
      { id: 'file-1' },
      expect.objectContaining({
        refetchInterval: false,
        staleTime: 5 * 60 * 1000,
      }),
    );
    expect(screen.getByTestId('chunk-pager')).not.toBeNull();
    expect(screen.getByTestId('chunk-header').textContent).toBe(
      '0:MarkItDownElement:# First chunk',
    );

    fireEvent.click(screen.getByRole('button', { name: 'next page' }));

    expect(screen.getByTestId('chunk-header').textContent).toBe(
      '1:LangChainElement:# Second chunk',
    );
  });

  it('shows a parse action instead of a blank preview when no chunks exist', () => {
    mocks.getAllByFileId.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: mocks.refetch,
    });

    render(<ChunkList fileId={'file-1'} />);

    expect(screen.getByTestId('chunk-empty')).not.toBeNull();
    expect(screen.getByText('FileManager.chunkEmpty.description')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'FileManager.chunkEmpty.parse' }));

    expect(mocks.parseFilesToChunks).toHaveBeenCalledWith(['file-1']);
  });

  it('polls while parsing and refetches once when parsing completes', () => {
    render(<ChunkList fileId={'file-1'} />);

    mocks.storeState.chunkingStatus = AsyncTaskStatus.Processing;
    mocks.storeState.fileList = [{ chunkingStatus: AsyncTaskStatus.Processing, id: 'file-1' }];
    notifyStoreSubscribers();

    expect(mocks.getAllByFileId).toHaveBeenLastCalledWith(
      { id: 'file-1' },
      expect.objectContaining({ refetchInterval: 3000 }),
    );

    mocks.storeState.chunkingStatus = AsyncTaskStatus.Success;
    mocks.storeState.fileList = [{ chunkingStatus: AsyncTaskStatus.Success, id: 'file-1' }];
    notifyStoreSubscribers();

    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
