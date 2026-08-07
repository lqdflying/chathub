import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChunkPager from './ChunkPager';

const responsiveState = vi.hoisted(() => ({ isMobile: false }));

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    disabled,
    onClick,
    title,
  }: {
    'aria-label': string;
    disabled?: boolean;
    onClick: () => void;
    title: string;
  }) => <button aria-label={ariaLabel} disabled={disabled} onClick={onClick} title={title} />,
  Markdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid={'chunk-markdown'}>{children}</div>
  ),
}));

vi.mock('antd', () => ({
  Pagination: ({
    current,
    onChange,
    pageSize,
    showQuickJumper,
    simple,
    total,
  }: {
    current: number;
    onChange: (page: number) => void;
    pageSize: number;
    showQuickJumper?: boolean;
    simple?: boolean;
    total: number;
  }) => (
    <div
      data-current={String(current)}
      data-page-size={String(pageSize)}
      data-quick-jumper={String(Boolean(showQuickJumper))}
      data-simple={String(Boolean(simple))}
      data-testid={'pagination'}
      data-total={String(total)}
    >
      {Array.from({ length: Math.ceil(total / pageSize) }, (_, index) => {
        const targetPage = index + 1;
        return (
          <button
            aria-label={`pagination-page-${targetPage}`}
            key={targetPage}
            onClick={() => onChange(targetPage)}
          />
        );
      })}
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: {
      pagination: 'pagination',
      paginationBar: 'pagination-bar',
      scroll: 'scroll',
    },
  }),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => responsiveState.isMobile,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => {
    if (opts && key.endsWith('.total')) return `${key}:${JSON.stringify(opts)}`;
    return key;
  } }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children, ref, ...rest }: any) => (
    <div ref={ref} {...rest}>
      {children}
    </div>
  ),
}));

describe('ChunkPager', () => {
  const makeChunks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: `text-${i + 1}` }));

  beforeEach(() => {
    responsiveState.isMobile = false;
  });

  it('renders nothing when chunks is empty', () => {
    const { container } = render(<ChunkPager chunks={[]} />);
    expect(container.children.length).toBe(0);
  });

  it('renders only the markdown and no pagination bar for a single chunk', () => {
    render(<ChunkPager chunks={makeChunks(1)} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');
    expect(screen.queryByTestId('pagination')).toBeNull();
    expect(screen.queryByLabelText('FilePreview.chunkPager.first')).toBeNull();
    expect(screen.queryByLabelText('FilePreview.chunkPager.last')).toBeNull();
  });

  it('starts at the initial index and paginates one chunk per page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={1} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-2');
    expect(screen.getByTestId('pagination').getAttribute('data-current')).toBe('2');
    expect(screen.getByTestId('pagination').getAttribute('data-page-size')).toBe('1');
    expect(screen.getByTestId('pagination').getAttribute('data-total')).toBe('3');
  });

  it('clamps an out-of-range initial index to the last page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={42} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-3');
    expect(screen.getByTestId('pagination').getAttribute('data-current')).toBe('3');
  });

  it('clamps a negative initial index to the first page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={-5} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');
    expect(screen.getByTestId('pagination').getAttribute('data-current')).toBe('1');
  });

  it('swaps the displayed chunk when the page changes and resets scrollTop', () => {
    render(<ChunkPager chunks={makeChunks(3)} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');

    fireEvent.click(screen.getByLabelText('pagination-page-2'));
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-2');
    expect(screen.getByTestId('pagination').getAttribute('data-current')).toBe('2');
  });

  it('enables first/last jumpers relative to the current page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={1} />);
    expect(
      (screen.getByLabelText('FilePreview.chunkPager.first') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText('FilePreview.chunkPager.last') as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByLabelText('FilePreview.chunkPager.last'));
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-3');
    expect(
      (screen.getByLabelText('FilePreview.chunkPager.last') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByLabelText('FilePreview.chunkPager.first'));
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');
    expect(
      (screen.getByLabelText('FilePreview.chunkPager.first') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renders compact simple pagination without quick jumper on mobile', () => {
    responsiveState.isMobile = true;
    render(<ChunkPager chunks={makeChunks(3)} />);
    const pagination = screen.getByTestId('pagination');
    expect(pagination.getAttribute('data-quick-jumper')).toBe('false');
    expect(pagination.getAttribute('data-simple')).toBe('true');
  });
});