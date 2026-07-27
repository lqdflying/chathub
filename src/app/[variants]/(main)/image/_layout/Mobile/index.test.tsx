import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Layout from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ icon, size, title, tooltipProps, ...props }: any) => (
    <button {...props} type="button">
      {title}
    </button>
  ),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = Object.assign(
    ({ center, right }: any) => (
      <header>
        {center}
        {right}
      </header>
    ),
    {
      Title: ({ title }: any) => <h1>{title}</h1>,
    },
  );

  return { ChatHeader };
});

vi.mock('antd', () => ({
  Drawer: ({ children, id, open, title }: any) =>
    open ? (
      <section aria-label={title} id={id} role="dialog">
        {children}
      </section>
    ) : null,
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({
    colorBgContainerSecondary: '#f5f5f5',
    colorBorderSecondary: '#ddd',
  }),
}));

vi.mock('@/components/NProgress', () => ({
  default: () => null,
}));

vi.mock('@/components/server/MobileNavLayout', () => ({
  default: ({ children, header, withNav }: any) => (
    <main data-with-nav={withNav}>
      {header}
      {children}
    </main>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
}));

describe('mobile Image layout', () => {
  it('mounts the image workspace before the settings drawer opens', () => {
    const onWorkspaceMount = vi.fn();

    const ImageWorkspace = () => {
      useEffect(onWorkspaceMount, []);

      return <div>Initialized image workspace</div>;
    };

    render(
      <Layout menu={<div>Image settings content</div>} topic={<div>Image topics content</div>}>
        <ImageWorkspace />
      </Layout>,
    );

    expect(onWorkspaceMount).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Initialized image workspace')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'config.header.title' })).toBeNull();
  });

  it('renders the workspace and opens settings and topics in accessible drawers', () => {
    render(
      <Layout menu={<div>Image settings content</div>} topic={<div>Image topics content</div>}>
        <div>Generated images</div>
      </Layout>,
    );

    expect(screen.getByRole('heading', { name: 'tab.aiImage' })).toBeTruthy();
    expect(screen.getByText('Generated images')).toBeTruthy();
    expect(screen.queryByText('Coming Soon!')).toBeNull();

    const settingsButton = screen.getByRole('button', { name: 'config.header.title' });
    expect(settingsButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(settingsButton);
    expect(screen.getByRole('dialog', { name: 'config.header.title' }).textContent).toContain(
      'Image settings content',
    );
    expect(settingsButton.getAttribute('aria-expanded')).toBe('true');

    const topicsButton = screen.getByRole('button', { name: 'topic.title' });
    fireEvent.click(topicsButton);
    expect(screen.getByRole('dialog', { name: 'topic.title' }).textContent).toContain(
      'Image topics content',
    );
  });

  it('keeps the settings drawer mounted through failure and retry recovery', async () => {
    const retryFinished = createDeferred();
    const onMenuMount = vi.fn();
    let showFailure!: () => void;

    const RecoveryMenu = () => {
      const [state, setState] = useState<'failure' | 'loading' | 'settled'>('loading');

      useEffect(onMenuMount, []);
      showFailure = () => setState('failure');

      if (state === 'loading') return <div>Image settings loading</div>;
      if (state === 'settled') return <div>Image settings controls</div>;

      return (
        <div role="alert">
          Image settings failed
          <button
            onClick={async () => {
              setState('loading');
              await retryFinished.promise;
              setState('settled');
            }}
            type="button"
          >
            Retry image settings
          </button>
        </div>
      );
    };

    render(
      <Layout menu={<RecoveryMenu />} topic={<div>Image topics content</div>}>
        <div>Generated images</div>
      </Layout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'config.header.title' }));
    const settingsDialog = screen.getByRole('dialog', { name: 'config.header.title' });
    expect(settingsDialog.textContent).toContain('Image settings loading');

    act(() => {
      showFailure();
    });
    expect(settingsDialog.textContent).toContain('Image settings failed');

    fireEvent.click(screen.getByRole('button', { name: 'Retry image settings' }));
    expect(settingsDialog.textContent).toContain('Image settings loading');

    await act(async () => {
      retryFinished.resolve();
      await retryFinished.promise;
    });

    await waitFor(() => {
      expect(settingsDialog.textContent).toContain('Image settings controls');
    });
    expect(screen.getByRole('dialog', { name: 'config.header.title' })).toBe(settingsDialog);
    expect(onMenuMount).toHaveBeenCalledTimes(1);
  });
});

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};
