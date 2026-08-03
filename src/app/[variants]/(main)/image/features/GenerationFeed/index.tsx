'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Divider } from 'antd';
import React, { Fragment, memo, useCallback, useEffect, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useImageStore } from '@/store/image';
import { generationBatchSelectors } from '@/store/image/selectors';

import { GenerationBatchItem } from './BatchItem';

const getScrollParent = (element: HTMLElement): HTMLElement => {
  let parent = element.parentElement;

  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return parent;

    parent = parent.parentElement;
  }

  return (document.scrollingElement as HTMLElement | null) || document.documentElement;
};

const getAccessibleScrollBehavior = (behavior: ScrollBehavior): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior;

const GenerationFeed = memo(() => {
  const [parent, enableAnimations] = useAutoAnimate();
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const prevBatchesCountRef = useRef(0);

  const currentGenerationBatches = useImageStore(generationBatchSelectors.currentGenerationBatches);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return;

    const scrollableParent = getScrollParent(containerRef.current);
    const targetRect = containerRef.current.getBoundingClientRect();
    const scrollableRect = scrollableParent.getBoundingClientRect();
    const promptContainer = scrollableParent.querySelector<HTMLElement>(
      '[data-image-prompt-container]',
    );
    const promptTop = promptContainer?.getBoundingClientRect().top;
    const visibleBottom =
      promptTop !== undefined && promptTop > scrollableRect.top
        ? Math.min(scrollableRect.bottom, promptTop)
        : scrollableRect.bottom;
    const hiddenDistance = targetRect.bottom - visibleBottom;

    if (hiddenDistance <= 0) return;

    scrollableParent.scrollTo({
      behavior: getAccessibleScrollBehavior(behavior),
      top: Math.max(0, scrollableParent.scrollTop + hiddenDistance),
    });
  }, []);

  // Auto-scroll to bottom, with different behavior for initial load vs. updates
  useEffect(() => {
    const currentBatches = currentGenerationBatches || [];
    const currentBatchesCount = currentBatches.length;
    const prevBatchesCount = prevBatchesCountRef.current;

    if (currentBatchesCount === 0) {
      prevBatchesCountRef.current = 0;
      return;
    }

    prevBatchesCountRef.current = currentBatchesCount;

    if (isInitialLoadRef.current) {
      // On initial load, scroll instantly to the end.
      scrollToBottom('auto');
      isInitialLoadRef.current = false;
    } else if (currentBatchesCount > prevBatchesCount) {
      // For subsequent updates where a batch was ADDED, scroll smoothly.
      enableAnimations(false);
      // Wait for React to re-render without animations.
      const timer = setTimeout(() => {
        scrollToBottom('smooth');
        // Re-enable animations for future interactions like deleting items.
        enableAnimations(true);
      }, 50); // A small delay is enough.

      return () => clearTimeout(timer);
    }
  }, [currentGenerationBatches, enableAnimations, scrollToBottom]);

  if (!currentGenerationBatches || currentGenerationBatches.length === 0) {
    return null;
  }

  return (
    <>
      <Flexbox flex={1} gap={16} ref={parent} width="100%">
        {currentGenerationBatches.map((batch, index) => (
          <Fragment key={batch.id}>
            {Boolean(index !== 0) && <Divider dashed style={{ margin: 0 }} />}
            <GenerationBatchItem batch={batch} key={batch.id} />
          </Fragment>
        ))}
      </Flexbox>
      {/* Invisible element for scroll target */}
      <div data-generation-feed-end ref={containerRef} style={{ height: 1 }} />
    </>
  );
});

GenerationFeed.displayName = 'GenerationFeed';

export default GenerationFeed;
