import { ChatFileChunk } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChunkItem from './index';

vi.stubGlobal('React', React);

const openFilePreview = vi.hoisted(() => vi.fn());
const useChatStoreMock = vi.hoisted(() => vi.fn(() => openFilePreview));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: any) => any) => selector({ openFilePreview: useChatStoreMock() }),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/FileIcon', () => ({
  default: () => <div data-testid={'file-icon'} />,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: { badge: 'badge', container: 'container', mobile: 'mobile' },
  }),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children, onClick, ...rest }: any) => (
    <div onClick={onClick} {...rest}>
      {children}
    </div>
  ),
}));

vi.mock('./style', () => ({
  useStyles: () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: { badge: 'badge', container: 'container', mobile: 'mobile' },
  }),
}));

describe('FileChunks/Item', () => {
  const baseChunk: ChatFileChunk = {
    fileId: 'file-1',
    fileType: 'md',
    fileUrl: 'https://example.com/a.md',
    filename: 'a.md',
    id: 'c2',
    text: 'second chunk text',
  };

  const chunks: ChatFileChunk[] = [
    { ...baseChunk, id: 'c1', text: 'first chunk text' },
    baseChunk,
    { ...baseChunk, id: 'c3', text: 'third chunk text' },
  ];

  beforeEach(() => {
    openFilePreview.mockReset();
  });

  it('forwards the retrieved chunks list and the clicked chunk id into openFilePreview', () => {
    render(<ChunkItem chunks={chunks} index={1} {...baseChunk} />);

    fireEvent.click(screen.getByText('a.md').closest('div')!);

    expect(openFilePreview).toHaveBeenCalledTimes(1);
    expect(openFilePreview).toHaveBeenCalledWith({
      chunkId: 'c2',
      chunkText: 'second chunk text',
      chunks,
      fileId: 'file-1',
    });
  });
});
