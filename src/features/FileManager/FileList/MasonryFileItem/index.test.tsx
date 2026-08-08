import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MasonryFileItem from '.';

function joinClassNames(...classNames: unknown[]): string {
  return classNames.filter(Boolean).join(' ');
}

function getMockStyles() {
  return {
    cx: joinClassNames,
    styles: {
      actions: 'actions',
      card: 'card',
      checkbox: 'checkbox',
      content: 'content',
      contentWithPadding: 'contentWithPadding',
      dropdown: 'dropdown',
      floatingChunkBadge: 'floatingChunkBadge',
      hoverOverlay: 'hoverOverlay',
      iconWrapper: 'iconWrapper',
      imagePlaceholder: 'imagePlaceholder',
      imageWrapper: 'imageWrapper',
      markdownLoading: 'markdownLoading',
      markdownPreview: 'markdownPreview',
      name: 'name',
      overlaySize: 'overlaySize',
      overlayTitle: 'overlayTitle',
      selected: 'selected',
    },
  };
}

function createMockStyles() {
  return getMockStyles;
}

function selectNotCreatingFileParseTask(): boolean {
  return false;
}

function getNotCreatingFileParseTaskSelector() {
  return selectNotCreatingFileParseTask;
}

const mocks = vi.hoisted(() => ({
  onOpen: vi.fn(),
  openChunkDrawer: vi.fn(),
  parseFilesToChunks: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('@lobechat/utils', () => ({
  isChunkableFile: () => true,
  isOfficePreviewFile: (name: string) => /\.(doc|docx|odt|ppt|pptx|xls|xlsx)$/i.test(name),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick} type={'button'}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Checkbox: () => <input type={'checkbox'} />,
  Image: () => null,
}));

vi.mock('antd-style', () => ({
  createStyles: createMockStyles,
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: React.MouseEventHandler<HTMLDivElement> }>) => (
    <div onClick={onClick}>{children}</div>
  ),
}));

vi.mock('@/components/FileIcon', () => ({ default: () => <span /> }));
vi.mock('@/utils/format', () => ({ formatSize: () => '1 KB' }));
vi.mock('../FileListItem/ChunkTag', () => ({ default: () => null }));
vi.mock('../FileListItem/DropdownMenu', () => ({ default: () => null }));
vi.mock('../MarkItDownAction', () => ({ default: () => null }));

vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    isCreatingFileParseTask: getNotCreatingFileParseTaskSelector,
  },
  useFileStore: (selector: (state: unknown) => unknown) =>
    selector({
      openChunkDrawer: mocks.openChunkDrawer,
      parseFilesToChunks: mocks.parseFilesToChunks,
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

class IntersectionObserverMock {
  disconnect() {}

  observe() {}
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

const createFileProps = (
  overrides: Partial<React.ComponentProps<typeof MasonryFileItem>> = {},
) => ({
  chunkCount: 0,
  chunkingError: null,
  chunkingStatus: undefined,
  embeddingError: null,
  embeddingStatus: undefined,
  fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  finishEmbedding: false,
  id: 'file-1',
  name: 'inventory.xlsx',
  onOpen: mocks.onOpen,
  onSelectedChange: vi.fn(),
  size: 1024,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  url: 'files/inventory.xlsx',
  ...overrides,
});

describe('MasonryFileItem opening behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens an unparsed Office file in the chunk drawer', () => {
    render(<MasonryFileItem {...createFileProps()} />);

    fireEvent.click(screen.getByText('inventory.xlsx'));

    expect(mocks.openChunkDrawer).toHaveBeenCalledWith('file-1');
    expect(mocks.onOpen).not.toHaveBeenCalled();
  });

  it('opens an unsupported legacy Office file in the explanatory chunk drawer', () => {
    render(
      <MasonryFileItem
        {...createFileProps({
          fileType: 'application/msword',
          name: 'legacy.doc',
        })}
      />,
    );

    fireEvent.click(screen.getByText('legacy.doc'));

    expect(mocks.openChunkDrawer).toHaveBeenCalledWith('file-1');
    expect(mocks.onOpen).not.toHaveBeenCalled();
  });

  it('continues to use the file preview callback for non-Office files', () => {
    render(
      <MasonryFileItem
        {...createFileProps({
          fileType: 'text/plain',
          id: 'notes-file',
          name: 'notes.txt',
        })}
      />,
    );

    fireEvent.click(screen.getByText('notes.txt'));

    expect(mocks.openChunkDrawer).not.toHaveBeenCalled();
    expect(mocks.onOpen).toHaveBeenCalledWith('notes-file');
  });
});
