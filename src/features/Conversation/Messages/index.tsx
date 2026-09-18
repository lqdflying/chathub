'use client';

import { createStyles } from 'antd-style';
import { ReactNode, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import {
  removeVirtuosoVisibleItem,
  upsertVirtuosoVisibleItem,
} from '@/features/Conversation/components/VirtualizedList/VirtuosoContext';
import {
  captureSettledRowHeight,
  resolveFrozenRowMinHeight,
} from '@/features/Conversation/components/VirtualizedList/scrollViewport';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import History from '../components/History';
import { InPortalThreadContext } from '../context/InPortalThreadContext';
import AssistantMessage from './Assistant';
import SupervisorMessage from './Supervisor';
import UserMessage from './User';

const useStyles = createStyles(({ css, prefixCls }) => ({
  loading: css`
    opacity: 0.6;
  `,
  message: css`
    position: relative;
    // prevent the textarea too long
    .${prefixCls}-input {
      max-height: 900px;
    }
  `,
}));

export interface ChatListItemProps {
  className?: string;
  disableEditing?: boolean;
  enableHistoryDivider?: boolean;
  endRender?: ReactNode;
  id: string;
  inPortalThread?: boolean;
  index: number;
  isScrolling?: boolean;
}

const Item = memo<ChatListItemProps>(
  ({
    className,
    enableHistoryDivider,
    id,
    endRender,
    disableEditing,
    inPortalThread = false,
    index,
    isScrolling,
  }) => {
    const { styles, cx } = useStyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const settledHeightRef = useRef<number | undefined>(undefined);
    const isScrollingRef = useRef(false);
    const [frozenHeight, setFrozenHeight] = useState<number>();
    isScrollingRef.current = !!isScrolling;

    const raw = useChatStore(chatSelectors.getRawMessageById(id));
    const item = useMemo(
      () => (raw ? { ...raw, meta: chatSelectors.getMessageMeta(raw) } : undefined),
      [raw],
    );

    const [isMessageLoading] = useChatStore((s) => [chatSelectors.isMessageLoading(id)(s)]);

    // ======================= Performance Optimization ======================= //
    // these useMemo/useCallback are all for the performance optimization
    // maybe we can remove it in React 19
    // ======================================================================== //

    useEffect(() => {
      if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

      const element = containerRef.current;
      if (!element) return;

      const root = element.closest('[data-virtuoso-scroller]');
      const options: any = { threshold: 0 };

      if (root instanceof Element) options.root = root;

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target !== element) return;

          if (entry.isIntersecting) {
            const { bottom, top } = entry.intersectionRect;

            upsertVirtuosoVisibleItem(index, {
              bottom,
              ratio: entry.intersectionRatio,
              top,
            });
          } else {
            removeVirtuosoVisibleItem(index);
          }
        });
      }, options);

      observer.observe(element);

      return () => {
        observer.disconnect();
        removeVirtuosoVisibleItem(index);
      };
    }, [index]);

    // Sample idle height only. Measuring after light markdown freezes the
    // short <pre> and the Shiki restore jumps the list (PC hover shiver).
    // https://virtuoso.dev/react-virtuoso/virtuoso/scroll-handling/
    useLayoutEffect(() => {
      const measured = containerRef.current?.getBoundingClientRect().height;
      const nextSettled = captureSettledRowHeight(!!isScrolling, measured, settledHeightRef.current);
      settledHeightRef.current = nextSettled;

      const nextFrozen = resolveFrozenRowMinHeight(!!isScrolling, nextSettled);
      if (nextFrozen !== frozenHeight) setFrozenHeight(nextFrozen);
    }, [frozenHeight, isScrolling, item]);

    // Width / late child layout can change height without replacing `item`.
    // ResizeObserver reports those boxes ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)).
    // Write the ref only — do not setState here, or minHeight would loop the observer.
    useEffect(() => {
      const element = containerRef.current;
      if (!element || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(() => {
        if (isScrollingRef.current) return;

        const measured = element.getBoundingClientRect().height;
        settledHeightRef.current = captureSettledRowHeight(
          false,
          measured,
          settledHeightRef.current,
        );
      });

      observer.observe(element);

      return () => observer.disconnect();
    }, [id, item?.id]);

    const renderContent = useMemo(() => {
      switch (item?.role) {
        case 'user': {
          return (
            <UserMessage
              {...item}
              disableEditing={disableEditing}
              index={index}
              isScrolling={isScrolling}
            />
          );
        }

        case 'assistant': {
          return (
            <AssistantMessage
              {...item}
              disableEditing={disableEditing}
              index={index}
              isScrolling={isScrolling}
              showTitle={item.groupId ? true : false}
            />
          );
        }

        case 'supervisor': {
          return <SupervisorMessage {...item} disableEditing={disableEditing} index={index} />;
        }
      }

      return null;
    }, [disableEditing, index, isScrolling, item]);

    if (!item) return;

    return (
      <InPortalThreadContext.Provider value={inPortalThread}>
        {enableHistoryDivider && <History />}
        <Flexbox
          className={cx(styles.message, className, isMessageLoading && styles.loading)}
          data-index={index}
          ref={containerRef}
          style={frozenHeight ? { minHeight: frozenHeight } : undefined}
        >
          {renderContent}
          {endRender}
        </Flexbox>
      </InPortalThreadContext.Provider>
    );
  },
);

Item.displayName = 'ChatItem';

export default Item;
