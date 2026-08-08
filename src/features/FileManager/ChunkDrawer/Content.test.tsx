import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Content from './Content';

const mocks = vi.hoisted(() => ({
  file: {
    chunkCount: 3,
    chunkingError: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    embeddingError: null,
    embeddingStatus: 'success',
    fileType: 'text/html',
    finishEmbedding: true,
    id: 'html-file',
    name: 'report.html',
    size: 2048,
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    url: 'files/report.html',
  },
  semanticSearch: vi.fn(),
  showSimilaritySearch: false,
}));

function getMockStyles() {
  return { styles: { basicInfo: 'basic-info' } };
}

function createMockStyles() {
  return getMockStyles;
}

function selectMockFile() {
  return mocks.file;
}

function getMockFileSelector() {
  return selectMockFile;
}

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  SearchBar: () => <div data-testid={'search-bar'} />,
}));

vi.mock('antd-style', () => ({
  createStyles: createMockStyles,
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('./FileBasicInfo', () => ({
  default: ({ file }: { file: { name: string } }) => (
    <div data-testid={'file-basic-info'}>{file.name}</div>
  ),
}));

vi.mock('./ChunkList', () => ({
  default: () => <div data-testid={'chunk-list'} />,
}));

vi.mock('./SimilaritySearchList', () => ({
  default: () => <div data-testid={'similarity-search-list'} />,
}));

vi.mock('@/store/file/slices/chunk', () => ({
  fileChunkSelectors: {
    enabledChunkFileId: (state: { fileId: string }) => state.fileId,
    showSimilaritySearchResult: () => mocks.showSimilaritySearch,
  },
}));

vi.mock('@/store/file', () => {
  const state = {
    fileId: mocks.file.id,
    semanticSearch: mocks.semanticSearch,
  };
  const useFileStore = (selector: (storeState: typeof state) => unknown) => selector(state);
  useFileStore.setState = vi.fn();

  return {
    fileManagerSelectors: {
      getFileById: getMockFileSelector,
    },
    useFileStore,
  };
});

const expectEarlierInDocument = (earlierElement: HTMLElement, laterElement: HTMLElement) => {
  expect(earlierElement.compareDocumentPosition(laterElement)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

describe('ChunkDrawer Content', () => {
  beforeEach(() => {
    mocks.showSimilaritySearch = false;
    vi.clearAllMocks();
  });

  it('keeps basic information above search and chunk pagination content', () => {
    render(<Content />);

    const basicInfo = screen.getByTestId('file-basic-info');
    const searchBar = screen.getByTestId('search-bar');
    const chunkList = screen.getByTestId('chunk-list');

    expect(screen.getByText('report.html')).toBeTruthy();
    expectEarlierInDocument(basicInfo, searchBar);
    expectEarlierInDocument(searchBar, chunkList);
  });

  it('keeps basic information visible above similarity search results', () => {
    mocks.showSimilaritySearch = true;

    render(<Content />);

    const basicInfo = screen.getByTestId('file-basic-info');
    const similaritySearchList = screen.getByTestId('similarity-search-list');

    expectEarlierInDocument(basicInfo, similaritySearchList);
    expect(screen.queryByTestId('chunk-list')).toBeNull();
  });
});
