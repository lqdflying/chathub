'use client';

import React, { PropsWithChildren, memo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useMediaQuery } from 'react-responsive';

import { MOBILE_TABBAR_SAFE_HEIGHT } from '@/const/layoutTokens';

const KnowledgeRouteContainer = memo<PropsWithChildren>(({ children }) => {
  const isMobile = useMediaQuery({ maxWidth: 768 });

  return (
    <Flexbox
      flex={1}
      height={'100%'}
      horizontal
      style={{
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        paddingBottom: isMobile ? MOBILE_TABBAR_SAFE_HEIGHT : undefined,
        position: 'relative',
      }}
      width={'100%'}
    >
      {children}
    </Flexbox>
  );
});

KnowledgeRouteContainer.displayName = 'KnowledgeRouteContainer';

export default KnowledgeRouteContainer;
