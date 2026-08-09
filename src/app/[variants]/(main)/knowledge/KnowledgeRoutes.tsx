'use client';

import { usePathname } from 'next/navigation';
import React, { memo } from 'react';

import KnowledgeBaseDetailPage from './routes/KnowledgeBaseDetail';
import KnowledgeBasesListPage from './routes/KnowledgeBasesList';
import KnowledgeHomePage from './routes/KnowledgeHome';

interface KnowledgeRoutesProps {
  /** When true, render the compact mobile variant of each route. */
  mobile?: boolean;
}

/**
 * Pathname-based Knowledge route renderer.
 *
 * The catch-all `/knowledge/[[...path]]` page mounts this component, so the
 * Next.js App Router owns every Knowledge subroute. The browser Back button
 * follows real history because each user-selected surface navigates with
 * `router.push` (see `useFileCategory`, `KnowledgeBaseItem`, etc.).
 *
 * - `/knowledge`             -> home workspace (All Files filtered by `?category=`)
 * - `/knowledge/bases`        -> desktop placeholder; mobile canonicalizes in the shell
 * - `/knowledge/bases/:id`    -> named knowledge base workspace
 */
const KnowledgeRoutes = memo<KnowledgeRoutesProps>(({ mobile = false }) => {
  const pathname = usePathname();

  const detailMatch = pathname?.match(/^\/knowledge\/bases\/([^/]+)$/);

  if (detailMatch) {
    return <KnowledgeBaseDetailPage id={detailMatch[1]} mobile={mobile} />;
  }

  // On mobile the shell canonicalizes `/knowledge/bases` to `/knowledge`; render
  // the home workspace briefly so there is no flash of an empty redirect.
  if (pathname === '/knowledge/bases') {
    if (mobile) return <KnowledgeHomePage mobile />;
    return <KnowledgeBasesListPage />;
  }

  return <KnowledgeHomePage mobile={mobile} />;
});

KnowledgeRoutes.displayName = 'KnowledgeRoutes';

export default KnowledgeRoutes;
