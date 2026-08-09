'use client';

import React, { PropsWithChildren, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

/**
 * Horizontal container for desktop Knowledge routes.
 *
 * Mobile safe-area spacing is owned by the mobile Knowledge shell, so this
 * container deliberately does not reserve the bottom tab-bar height. Rendering
 * it on mobile would double-count the bottom inset.
 */
const KnowledgeRouteContainer = memo<PropsWithChildren>(({ children }) => {
  return (
    <Flexbox
      flex={1}
      height={'100%'}
      horizontal
      style={{
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
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
