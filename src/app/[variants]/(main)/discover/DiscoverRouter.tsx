'use client';

import { memo, useEffect } from 'react';
import { useMediaQuery } from 'react-responsive';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import DetailLayout from './(detail)/_layout/DetailLayout';
import McpDetailPage from './(detail)/mcp/McpDetailPage';
import ListLayout from './(list)/_layout/ListLayout';
import McpLayout from './(list)/mcp/McpLayout';
import McpPage from './(list)/mcp/McpPage';
import DiscoverLayout from './_layout/DiscoverLayout';

// Get initial path from URL
const getInitialPath = () => {
  if (typeof window === 'undefined') return '/';
  const fullPath = window.location.pathname;
  const searchParams = window.location.search;
  const discoverIndex = fullPath.indexOf('/discover');

  if (discoverIndex !== -1) {
    const pathAfterDiscover = fullPath.slice(discoverIndex + '/discover'.length) || '/';
    return pathAfterDiscover + searchParams;
  }
  return '/';
};

// Helper component to sync URL with MemoryRouter
const UrlSynchronizer = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Sync initial URL
  useEffect(() => {
    const fullPath = window.location.pathname;
    const searchParams = window.location.search;
    const discoverIndex = fullPath.indexOf('/discover');

    if (discoverIndex !== -1) {
      const pathAfterDiscover = fullPath.slice(discoverIndex + '/discover'.length) || '/';
      const targetPath = pathAfterDiscover + searchParams;

      if (location.pathname + location.search !== targetPath) {
        navigate(targetPath, { replace: true });
      }
    }
  }, []);

  // Update browser URL when location changes
  useEffect(() => {
    const normalizedPath = location.pathname === '/' ? '' : location.pathname;
    const newUrl = `/discover${normalizedPath}${location.search}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [location.pathname, location.search]);

  return null;
};

const DiscoverRouter = memo(() => {
  const mobile = useMediaQuery({ maxWidth: 768 });

  return (
    <MemoryRouter initialEntries={[getInitialPath()]} initialIndex={0}>
      <UrlSynchronizer />
      <DiscoverLayout mobile={mobile}>
        <Routes>
          {/* Redirect home to MCP */}
          <Route element={<Navigate replace to="/mcp" />} path="/" />

          {/* MCP list */}
          <Route
            element={
              <ListLayout mobile={mobile}>
                <McpLayout mobile={mobile}>
                  <McpPage mobile={mobile} />
                </McpLayout>
              </ListLayout>
            }
            path="/mcp"
          />

          {/* MCP detail */}
          <Route
            element={
              <DetailLayout mobile={mobile}>
                <McpDetailPage mobile={mobile} />
              </DetailLayout>
            }
            path="/mcp/*"
          />

          {/* Fallback */}
          <Route element={<Navigate replace to="/mcp" />} path="*" />
        </Routes>
      </DiscoverLayout>
    </MemoryRouter>
  );
});

DiscoverRouter.displayName = 'DiscoverRouter';

export default DiscoverRouter;
