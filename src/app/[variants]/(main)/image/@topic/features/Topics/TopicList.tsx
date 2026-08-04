'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useSize } from 'ahooks';
import { memo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import TopicItem from './TopicItem';
import TopicToolbar from './TopicToolbar';

const TopicsList = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchGenerationTopics = useImageStore((s) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);
  const ref = useRef(null);
  const { width = 80 } = useSize(ref) || {};
  const [parent] = useAutoAnimate();
  const generationTopics = useImageStore(generationTopicSelectors.generationTopics);
  const openNewGenerationTopic = useImageStore((s) => s.openNewGenerationTopic);

  const showMoreInfo = Boolean(width > 120);
  const showToolbarLabel = Boolean(width > 240);

  return (
    <Flexbox
      align="center"
      gap={12}
      ref={ref}
      style={{
        height: '100%',
        maxHeight: '100%',
        overflow: 'hidden',
        padding: showMoreInfo ? '8px 12px' : '8px 0',
      }}
      width={'100%'}
    >
      <TopicToolbar
        count={generationTopics?.length}
        onCreate={openNewGenerationTopic}
        showMoreInfo={showMoreInfo}
        showTitle={showToolbarLabel}
      />
      <Flexbox
        align="center"
        flex={1}
        gap={12}
        ref={parent}
        style={{ overflowY: 'auto' }}
        width={'100%'}
      >
        {generationTopics.map((topic, index) => (
          <TopicItem
            key={topic.id}
            showMoreInfo={showMoreInfo}
            style={{
              padding:
                // fix the avatar border is clipped by overflow hidden
                generationTopics.length === 1
                  ? '4px 0'
                  : index === generationTopics.length - 1
                    ? '0 0 4px'
                    : '0',
            }}
            topic={topic}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

TopicsList.displayName = 'TopicsList';

export default TopicsList;
