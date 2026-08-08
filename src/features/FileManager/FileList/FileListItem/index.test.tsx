import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileRenderItem from '.';

function joinClassNames(...classNames: unknown[]): string {
  return classNames.filter(Boolean).join(' ');
}

function getMockStyles() {
  return {
    cx: joinClassNames,
    styles: {
      checkbox: 'checkbox',
      container: 'container',
      hover: 'hover',
      item: 'item',
      name: 'name',
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
  openChunkDrawer: vi.fn(),
  parseFilesToChunks: vi.fn(),
  setSearchParams: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('@lobechat/utils', () => ({
  isChunkableFile: () => true,
  isMarkItDownConvertibleFile: () => false,
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
}));

vi.mock('antd-style', () => ({
  createStyles: createMockStyles,
}));

vi.mock('react-layout-kit', () => ({
  Center: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: React.MouseEventHandler }>) => (
    <div onClick={onClick}>{children}</div>
  ),
  Flexbox: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: React.MouseEventHandler<HTMLDivElement> }>) => (
    <div onClick={onClick}>{children}</div>
  ),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
}));

vi.mock('@/components/FileIcon', () => ({ default: () => <span /> }));
vi.mock('@/utils/format', () => ({ formatSize: () => '1 KB' }));
vi.mock('../MarkItDownAction', () => ({ default: () => null }));
vi.mock('./ChunkTag', () => ({ default: () => null }));
vi.mock('./DropdownMenu', () => ({ default: () => null }));

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

const createFileProps = (overrides: Partial<React.ComponentProps<typeof FileRenderItem>> = {}) => ({
  chunkCount: 0,
  chunkingError: null,
  chunkingStatus: undefined,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  embeddingError: null,
  embeddingStatus: undefined,
  fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  finishEmbedding: false,
  id: 'file-1',
  index: 0,
  name: 'inventory.xlsx',
  onSelectedChange: vi.fn(),
  size: 1024,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  url: 'files/inventory.xlsx',
  ...overrides,
});

describe('FileRenderItem opening behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens an unparsed Office file in the chunk drawer', () => {
    render(<FileRenderItem {...createFileProps()} />);

    fireEvent.click(screen.getByText('inventory.xlsx'));

    expect(mocks.openChunkDrawer).toHaveBeenCalledWith('file-1');
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it('keeps Office files in the chunk drawer after chunking', () => {
    render(<FileRenderItem {...createFileProps({ chunkCount: 4 })} />);

    fireEvent.click(screen.getByText('inventory.xlsx'));

    expect(mocks.openChunkDrawer).toHaveBeenCalledWith('file-1');
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it('opens an unsupported legacy Office file in the explanatory chunk drawer', () => {
    render(
      <FileRenderItem
        {...createFileProps({
          fileType: 'application/msword',
          name: 'legacy.doc',
        })}
      />,
    );

    fireEvent.click(screen.getByText('legacy.doc'));

    expect(mocks.openChunkDrawer).toHaveBeenCalledWith('file-1');
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it('continues to use the file preview route for non-Office files', () => {
    render(
      <FileRenderItem
        {...createFileProps({
          fileType: 'text/plain',
          id: 'notes-file',
          name: 'notes.txt',
        })}
      />,
    );

    fireEvent.click(screen.getByText('notes.txt'));

    expect(mocks.openChunkDrawer).not.toHaveBeenCalled();
    expect(mocks.setSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true });
  });
});
