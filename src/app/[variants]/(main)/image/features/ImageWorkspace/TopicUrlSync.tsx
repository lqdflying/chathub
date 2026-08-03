'use client';

import { useQueryState } from 'nuqs';
import { useLayoutEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useImageStore } from '@/store/image';

const TopicUrlSync = () => {
  const useStoreUpdater = createStoreUpdater(useImageStore);

  const [topic, setTopic] = useQueryState('topic', { history: 'replace', throttleMs: 500 });
  useStoreUpdater('activeGenerationTopicId', topic);

  useLayoutEffect(() => {
    const unsubscribeTopic = useImageStore.subscribe(
      (state) => state.activeGenerationTopicId,
      (activeTopicId) => {
        setTopic(activeTopicId || null);
      },
    );

    return () => {
      unsubscribeTopic();
    };
  }, [setTopic]);

  return null;
};

TopicUrlSync.displayName = 'TopicUrlSync';

export default TopicUrlSync;
