'use client';

import React from 'react';

import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/selectors';

import Content from './Content';
import EmptyState from './EmptyState';
import TopicUrlSync from './TopicUrlSync';

const ImageWorkspace = () => {
  useFetchAiImageConfig();
  const activeTopicId = useImageStore(generationTopicSelectors.activeGenerationTopicId);

  return (
    <>
      <TopicUrlSync />
      {activeTopicId ? <Content /> : <EmptyState />}
    </>
  );
};

export default ImageWorkspace;
