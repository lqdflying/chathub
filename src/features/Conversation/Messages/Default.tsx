import { UIChatMessage } from '@lobechat/types';
import { ReactNode, memo, useEffect, useState } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

// A freshly-created assistant row is persisted as LOADING_FLAT before its id is
// added to `chatLoadingIds`, so a "not generating" check alone would blank every
// send during that window. Treat a LOADING_FLAT placeholder as interrupted only
// once it is both not generating AND older than this: a reloaded orphan (old
// createdAt) qualifies immediately, while a live send keeps showing dots.
const STALE_MS = 3000;

const InterruptibleLoading = memo<{ createdAt: number; id: string }>(({ createdAt, id }) => {
  const generating = useChatStore(chatSelectors.isMessageGenerating(id));
  const [stale, setStale] = useState(() => Date.now() - createdAt > STALE_MS);

  useEffect(() => {
    if (generating || stale) return;
    const timer = setTimeout(() => setStale(true), STALE_MS);
    return () => clearTimeout(timer);
  }, [generating, stale]);

  // an interrupted placeholder renders nothing rather than looping on dots
  return generating || !stale ? <BubblesLoading /> : null;
});

export const DefaultMessage = memo<
  UIChatMessage & {
    addIdOnDOM?: boolean;
    editableContent: ReactNode;
    isToolCallGenerating?: boolean;
  }
>(({ id, createdAt, editableContent, content, isToolCallGenerating, addIdOnDOM = true }) => {
  const editing = useChatStore(chatSelectors.isMessageEditing(id));

  if (isToolCallGenerating) return;

  if (content === LOADING_FLAT && !editing)
    return <InterruptibleLoading createdAt={createdAt} id={id} />;

  return <div id={addIdOnDOM ? id : undefined}>{editableContent}</div>;
});

export const DefaultBelowMessage = memo<UIChatMessage>(() => {
  return null;
});
