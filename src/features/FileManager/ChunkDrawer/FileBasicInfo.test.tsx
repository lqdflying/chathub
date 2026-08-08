import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBasicInfo from './FileBasicInfo';

const mocks = vi.hoisted(() => ({
  containerWidth: 640,
  descriptionsProps: [] as Array<{ column?: number }>,
  downloadFile: vi.fn(),
}));

function getMockStyles() {
  return { styles: { compact: 'compact' } };
}

function createMockStyles() {
  return getMockStyles;
}

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    onClick,
    title,
  }: {
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    title?: string;
  }) => <button aria-label={title} onClick={onClick} type={'button'} />,
  Icon: () => null,
  Tag: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('ahooks', () => ({
  useSize: () => ({ width: mocks.containerWidth }),
}));

vi.mock('antd', () => ({
  Descriptions: (props: {
    column?: number;
    extra?: React.ReactNode;
    items?: Array<{ children: React.ReactNode; key: React.Key; label: React.ReactNode }>;
    title?: React.ReactNode;
  }) => {
    mocks.descriptionsProps.push(props);

    return (
      <section>
        <h2>{props.title}</h2>
        {props.extra}
        {props.items?.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <span>{item.children}</span>
          </div>
        ))}
      </section>
    );
  },
  Divider: () => <hr />,
}));

vi.mock('antd-style', () => ({
  createStyles: createMockStyles,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/utils/client/downloadFile', () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock('@/utils/format', () => ({
  formatSize: () => '2 KB',
}));

const file = {
  chunkCount: 7,
  chunkingError: null,
  createdAt: new Date(2026, 7, 1, 9, 30),
  embeddingError: null,
  embeddingStatus: 'success' as const,
  fileType: 'text/html',
  finishEmbedding: true,
  id: 'html-file',
  name: 'report.html',
  size: 2048,
  updatedAt: new Date(2026, 7, 2, 10, 45),
  url: 'files/report.html',
};

describe('FileBasicInfo', () => {
  beforeEach(() => {
    mocks.containerWidth = 640;
    mocks.descriptionsProps = [];
    vi.clearAllMocks();
  });

  it('renders compact file metadata, chunk data, and embedding status', () => {
    render(<FileBasicInfo file={file} variant={'compact'} />);

    expect(screen.getByText('detail.basic.title')).toBeTruthy();
    expect(screen.getByText('report.html')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('HTML')).toBeTruthy();
    expect(screen.getByText('2026-08-01 09:30')).toBeTruthy();
    expect(screen.getByText('2026-08-02 10:45')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('detail.data.embedding.success')).toBeTruthy();
    expect(mocks.descriptionsProps[0].column).toBe(4);
  });

  it.each([
    { columnCount: 1, containerWidth: 320 },
    { columnCount: 2, containerWidth: 480 },
  ])(
    'uses $columnCount compact columns when the drawer is $containerWidth pixels wide',
    ({ columnCount, containerWidth }) => {
      mocks.containerWidth = containerWidth;

      render(<FileBasicInfo file={file} variant={'compact'} />);

      expect(mocks.descriptionsProps[0].column).toBe(columnCount);
    },
  );

  it('downloads the selected file from the shared information renderer', () => {
    render(<FileBasicInfo file={file} variant={'compact'} />);

    fireEvent.click(screen.getByRole('button', { name: 'download' }));

    expect(mocks.downloadFile).toHaveBeenCalledWith('files/report.html', 'report.html');
  });
});
