'use client';

import { App } from 'antd';
import React, { Suspense, memo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useMediaQuery } from 'react-responsive';

import KnowledgeRoutes from './KnowledgeRoutes';
import KnowledgeMobileShell from './_layout/Mobile';
import RagProviderBanner from './components/RagProviderBanner';

/**
 * Main Knowledge Router.
 *
 * The Next.js App Router owns every Knowledge subroute (see `KnowledgeRoutes`):
 * paths, query parameters, deep links, and Back behavior all flow through
 * `usePathname` / `useSearchParams` / `useRouter`. There is no separate
 * in-memory router and no manual `replaceState`, so browser Back returns to the
 * previous Knowledge surface instead of leaving the section.
 *
 * The root is explicitly full-width so the centered global app container
 * (`align-items: center`) cannot shrink Knowledge to the intrinsic menu width.
 */
const KnowledgeRouter = memo(() => {
  const isMobile = useMediaQuery({ maxWidth: 768 });

  return (
    <App
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
      }}
    >
      {isMobile ? (
        <Suspense fallback={null}>
          <KnowledgeMobileShell>
            <KnowledgeRoutes mobile />
          </KnowledgeMobileShell>
        </Suspense>
      ) : (
        <Flexbox
          data-testid="knowledge-route-viewport"
          flex={1}
          height={'100%'}
          horizontal={false}
          style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', position: 'relative' }}
          width={'100%'}
        >
          <RagProviderBanner />
          <Suspense fallback={null}>
            <KnowledgeRoutes />
          </Suspense>
        </Flexbox>
      )}
    </App>
  );
});

KnowledgeRouter.displayName = 'KnowledgeRouter';

export default KnowledgeRouter;
