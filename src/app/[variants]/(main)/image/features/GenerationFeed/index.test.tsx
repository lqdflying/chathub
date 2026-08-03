import { act, cleanup, render, screen } from '@testing-library/react';
import React, { forwardRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageStore } from '@/store/image';

import GenerationFeed from './index';

const { enableAnimations } = vi.hoisted(() => ({ enableAnimations: vi.fn() }));

vi.mock('@formkit/auto-animate/react', () => ({
  useAutoAnimate: () => [vi.fn(), enableAnimations],
}));

vi.mock('antd', () => ({
  Divider: () => <hr />,
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) => (
    <div ref={ref}>{children}</div>
  )),
}));

vi.mock('./BatchItem', () => ({
  GenerationBatchItem: ({ batch }: { batch: { id: string } }) => <div>{batch.id}</div>,
}));

const createBatch = (id: string) => ({ id }) as any;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

const rect = ({ bottom, top }: { bottom: number; top: number }) =>
  ({
    bottom,
    height: bottom - top,
    left: 0,
    right: 320,
    toJSON: () => {},
    top,
    width: 320,
    x: 0,
    y: top,
  }) as DOMRect;

describe('GenerationFeed scrolling', () => {
  let feedEndBottom = 800;
  let reducedMotion = false;
  const scrollTo = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    enableAnimations.mockReset();
    scrollTo.mockReset();
    feedEndBottom = 800;
    reducedMotion = false;

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: reducedMotion,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        removeEventListener: vi.fn(),
      })),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.dataset.testid === 'scroll-parent') return rect({ bottom: 1000, top: 0 });
      if (this.hasAttribute('data-image-prompt-container')) return rect({ bottom: 1000, top: 900 });
      if (this.hasAttribute('data-generation-feed-end')) {
        return rect({ bottom: feedEndBottom, top: feedEndBottom - 1 });
      }

      return rect({ bottom: 100, top: 0 });
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });

    useImageStore.setState({
      activeGenerationTopicId: 'topic-1',
      generationBatchesMap: { 'topic-1': [createBatch('batch-1')] },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }
    useImageStore.setState({ activeGenerationTopicId: null, generationBatchesMap: {} });
  });

  const renderFeed = () =>
    render(
      <div data-testid="scroll-parent" style={{ overflowY: 'auto' }}>
        <GenerationFeed />
        <div data-image-prompt-container />
      </div>,
    );

  it('does not scroll when the feed end is already visible above the prompt', () => {
    renderFeed();

    expect(screen.getByText('batch-1')).toBeTruthy();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each([
    { expectedBehavior: 'smooth', label: 'standard motion', reduced: false },
    { expectedBehavior: 'auto', label: 'reduced motion', reduced: true },
  ])('scrolls once for an appended batch with $label', ({ expectedBehavior, reduced }) => {
    renderFeed();
    reducedMotion = reduced;
    feedEndBottom = 1200;

    act(() => {
      useImageStore.setState({
        generationBatchesMap: {
          'topic-1': [createBatch('batch-1'), createBatch('batch-2')],
        },
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: expectedBehavior, top: 300 });

    act(() => {
      useImageStore.setState({
        generationBatchesMap: {
          'topic-1': [createBatch('batch-1-updated'), createBatch('batch-2-updated')],
        },
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
