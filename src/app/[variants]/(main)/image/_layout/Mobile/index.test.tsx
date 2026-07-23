import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
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
});
