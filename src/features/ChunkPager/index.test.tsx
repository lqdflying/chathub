import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChunkPager from '.';

function joinClassNames(...classNames: unknown[]): string {
  return classNames.filter(Boolean).join(' ');
}

function getMockStyles() {
  return {
    cx: joinClassNames,
    styles: {
      body: 'body',
      bodyMedium: 'bodyMedium',
      bodyNarrow: 'bodyNarrow',
      markdown: 'markdown',
      markdownMedium: 'markdownMedium',
      markdownNarrow: 'markdownNarrow',
      pager: 'pager',
      pagerNarrow: 'pagerNarrow',
      root: 'root',
    },
  };
}

function createMockStyles() {
  return getMockStyles;
}

const mocks = vi.hoisted(() => ({
  responsiveState: { width: 560 },
}));

const makeChunks = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `chunk-${index + 1}`,
    text: `text-${index + 1}`,
  }));

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    'aria-label': ariaLabel,
    disabled,
    onClick,
    size,
    title,
  }: {
    'aria-label': string;
    'disabled'?: boolean;
    'onClick': () => void;
    'size': { blockSize: number; size: number };
    'title': string;
  }) => (
    <button
      aria-label={ariaLabel}
      data-block-size={String(size.blockSize)}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type={'button'}
    />
  ),
  Markdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid={'chunk-markdown'}>{children}</div>
  ),
}));

vi.mock('antd', () => ({
  Flex: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  Pagination: ({
    current,
    onChange,
    pageSize,
    showLessItems,
    showQuickJumper,
    simple,
    total,
  }: {
    current: number;
    onChange: (page: number) => void;
    pageSize: number;
    showLessItems?: boolean;
    showQuickJumper?: boolean;
    simple?: boolean;
    total: number;
  }) => (
    <div
      data-current={String(current)}
      data-less-items={String(Boolean(showLessItems))}
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
            type={'button'}
          />
        );
      })}
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  createStyles: createMockStyles,
}));

vi.mock('ahooks', () => ({
  useSize: () => ({ width: mocks.responsiveState.width }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ChunkPager', () => {
  beforeEach(() => {
    mocks.responsiveState.width = 560;
  });

  it('renders nothing when chunks is empty', () => {
    const { container } = render(<ChunkPager chunks={[]} />);
    expect(container.children.length).toBe(0);
  });

  it('renders only the markdown and no pagination bar for a single chunk', () => {
    render(<ChunkPager chunks={makeChunks(1)} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');
    expect(screen.queryByTestId('pagination')).toBeNull();
    expect(screen.queryByLabelText('chunkPager.first')).toBeNull();
    expect(screen.queryByLabelText('chunkPager.last')).toBeNull();
  });

  it('starts at the initial index and paginates one chunk per page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={1} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-2');
    expect(screen.getByTestId('pagination').dataset.current).toBe('2');
    expect(screen.getByTestId('pagination').dataset.pageSize).toBe('1');
    expect(screen.getByTestId('pagination').dataset.total).toBe('3');
  });

  it('clamps an out-of-range initial index to the last page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={42} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-3');
    expect(screen.getByTestId('pagination').dataset.current).toBe('3');
  });

  it('clamps a negative initial index to the first page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={-5} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');
    expect(screen.getByTestId('pagination').dataset.current).toBe('1');
  });

  it('swaps the displayed chunk when the page changes', () => {
    render(<ChunkPager chunks={makeChunks(3)} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');

    fireEvent.click(screen.getByLabelText('pagination-page-2'));
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-2');
    expect(screen.getByTestId('pagination').dataset.current).toBe('2');
  });

  it('enables first and last jumpers relative to the current page', () => {
    render(<ChunkPager chunks={makeChunks(3)} initialIndex={1} />);
    expect((screen.getByLabelText('chunkPager.first') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('chunkPager.last') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('chunkPager.last'));
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-3');
    expect((screen.getByLabelText('chunkPager.last') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('chunkPager.first'));
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-1');
    expect((screen.getByLabelText('chunkPager.first') as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses compact numbered pagination at medium panel widths', () => {
    mocks.responsiveState.width = 480;
    render(<ChunkPager chunks={makeChunks(3)} />);

    const pagination = screen.getByTestId('pagination');
    expect(pagination.dataset.quickJumper).toBe('false');
    expect(pagination.dataset.lessItems).toBe('true');
    expect(pagination.dataset.simple).toBe('false');
    expect(
      screen.getByTestId('pagination').parentElement?.parentElement?.dataset.pagerDensity,
    ).toBe('medium');
  });

  it('uses a simple one-line pager at narrow panel widths', () => {
    mocks.responsiveState.width = 360;
    render(<ChunkPager chunks={makeChunks(3)} />);

    const pagination = screen.getByTestId('pagination');
    expect(pagination.dataset.quickJumper).toBe('false');
    expect(pagination.dataset.simple).toBe('true');
    expect(screen.getByLabelText('chunkPager.first').dataset.blockSize).toBe('28');
    expect(screen.getByLabelText('chunkPager.last').dataset.blockSize).toBe('28');
    expect(
      screen.getByTestId('pagination').parentElement?.parentElement?.dataset.pagerDensity,
    ).toBe('narrow');
  });

  it('keeps the quick jumper only at wide panel widths', () => {
    mocks.responsiveState.width = 640;
    render(<ChunkPager chunks={makeChunks(6)} />);

    const pagination = screen.getByTestId('pagination');
    expect(pagination.dataset.quickJumper).toBe('true');
    expect(pagination.dataset.lessItems).toBe('false');
    expect(pagination.dataset.simple).toBe('false');
    expect(
      screen.getByTestId('pagination').parentElement?.parentElement?.dataset.pagerDensity,
    ).toBe('wide');
  });

  it('does not throw and re-clamps when the chunks list shrinks past the current page', () => {
    const { rerender } = render(<ChunkPager chunks={makeChunks(5)} initialIndex={4} />);
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-5');

    expect(() => rerender(<ChunkPager chunks={makeChunks(2)} initialIndex={4} />)).not.toThrow();
    expect(screen.getByTestId('chunk-markdown').textContent).toBe('text-2');
    expect(screen.getByTestId('pagination').dataset.current).toBe('2');
  });

  it('notifies consumers when a page changes', () => {
    const onPageChange = vi.fn();
    render(<ChunkPager chunks={makeChunks(3)} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByLabelText('pagination-page-2'));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
