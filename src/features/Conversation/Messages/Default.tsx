import { UIChatMessage } from '@lobechat/types';
import { ReactNode, memo, useEffect, useState } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

// A freshly-created assistant row is persisted as LOADING_FLAT before its id is
// added to `chatLoadingIds`, so a "not generating" check alone would blank every
// send during that window. Wait this long after mount (or after generating
// stops) before treating the placeholder as interrupted. Reloaded durable rows
// stay visible while an attached server job is still running.
const STALE_MS = 8000;

const InterruptibleLoading = memo<{ id: string }>(({ id }) => {
  const generating = useChatStore(chatSelectors.isMessageAwaitingServerGeneration(id));
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (generating) {
      setStale(false);
      return;
    }
    const timer = setTimeout(() => setStale(true), STALE_MS);
    return () => clearTimeout(timer);
  }, [generating]);

  // an interrupted placeholder renders nothing rather than looping on dots
  return generating || !stale ? <BubblesLoading /> : null;
});

export const DefaultMessage = memo<
  UIChatMessage & {
    addIdOnDOM?: boolean;
    editableContent: ReactNode;
    isToolCallGenerating?: boolean;
  }
>(({ id, editableContent, content, isToolCallGenerating, addIdOnDOM = true }) => {
  const editing = useChatStore(chatSelectors.isMessageEditing(id));

  if (isToolCallGenerating) return;

  if (content === LOADING_FLAT && !editing)
    return <InterruptibleLoading id={id} />;

  return <div id={addIdOnDOM ? id : undefined}>{editableContent}</div>;
});

export const DefaultBelowMessage = memo<UIChatMessage>(() => {
  return null;
});
