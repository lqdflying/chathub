import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import FileList from './index';

const mocks = vi.hoisted(() => ({
  fetchFiles: vi.fn(() => ({
    data: [
      {
        createdAt: new Date('2026-08-04T00:00:00Z'),
        fileType: 'text/html',
        id: 'html-file',
        name: 'PIL_ITSM_Azure_Hosting_Requirements.html',
        size: 100,
        url: 'files/test/document.html',
      },
    ],
    isLoading: false,
  })),
  updateSystemStatus: vi.fn(),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: { header: 'header', headerItem: 'headerItem', total: 'total' },
  }),
}));
vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('nuqs', () => ({ useQueryState: () => [undefined] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data }: { data?: unknown[] }) => <div data-testid="file-results">{data?.length}</div>,
}));
vi.mock('@virtuoso.dev/masonry', () => ({
  VirtuosoMasonry: () => <div />,
}));
vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: unknown) => unknown) =>
    selector({ useFetchFileManage: mocks.fetchFiles }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({
      status: { fileManagerViewMode: 'list' },
      updateSystemStatus: mocks.updateSystemStatus,
    }),
}));
vi.mock('./EmptyStatus', () => ({ default: () => <div /> }));
vi.mock('./FileListItem', () => ({
  FILE_DATE_WIDTH: 160,
  FILE_SIZE_WIDTH: 140,
  default: () => <div />,
}));
vi.mock('./FileSkeleton', () => ({ default: () => <div /> }));
vi.mock('./MasonryFileItem/MasonryItemWrapper', () => ({ default: () => <div /> }));
vi.mock('./MasonrySkeleton', () => ({ default: () => <div /> }));
vi.mock('./ToolBar', () => ({
  default: ({
    config,
    onConfigChange,
  }: {
    config: { showFilesInKnowledgeBase: boolean };
    onConfigChange: (config: { showFilesInKnowledgeBase: boolean }) => void;
  }) => (
    <button
      data-testid="knowledge-visibility-toggle"
      onClick={() => onConfigChange({ showFilesInKnowledgeBase: false })}
    >
      {String(config.showFilesInKnowledgeBase)}
    </button>
  ),
}));
vi.mock('./useCheckTaskStatus', () => ({ useCheckTaskStatus: vi.fn() }));

describe('FileList knowledge-base visibility', () => {
  it('shows files associated with a knowledge base by default and keeps the hide control', () => {
    render(<FileList knowledgeMode onOpenFile={vi.fn()} />);

    expect(mocks.fetchFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ showFilesInKnowledgeBase: true }),
    );
    expect(screen.getByTestId('knowledge-visibility-toggle').textContent).toBe('true');

    fireEvent.click(screen.getByTestId('knowledge-visibility-toggle'));

    expect(mocks.fetchFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ showFilesInKnowledgeBase: false }),
    );
  });
});
