'use client';

import { useQueryState } from 'nuqs';
import React from 'react';

import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';

import Content from './Content';
import EmptyState from './EmptyState';

const ImageWorkspace = () => {
  const [topic] = useQueryState('topic');
  useFetchAiImageConfig();

  if (!topic) {
    return <EmptyState />;
  }

  return <Content />;
};

export default ImageWorkspace;
