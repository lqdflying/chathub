import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Layout from './index';

const { navigationState, pushMock } = vi.hoisted(() => ({
  navigationState: {
    pathname: '/tools/password',
  },
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ icon, size, title, tooltipProps, ...props }: any) => (
    <button {...props} type="button">
      {title}
    </button>
  ),
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = Object.assign(
    ({ center, left }: any) => (
      <header>
        {left}
        {center}
      </header>
    ),
    {
      Title: ({ title }: any) => <h1>{title}</h1>,
    },
  );

  return { ChatHeader };
});

vi.mock('antd', () => ({
  Drawer: ({ children, id, onClose, open, title }: any) =>
    open ? (
      <section aria-label={title} id={id} role="dialog">
        <button onClick={onClose} type="button">
          close
        </button>
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

vi.mock('@/components/Menu', () => ({
  default: ({ items, onClick, selectedKeys }: any) => (
    <div data-selected-keys={selectedKeys.join(',')} role="menu">
      {items.map((item: any) => (
        <button key={item.key} onClick={() => onClick({ key: item.key })} role="menuitem">
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/server/MobileNavLayout', () => ({
  default: ({ children, header, padding, withNav }: any) => (
    <main data-padding={padding} data-with-nav={withNav}>
      {header}
      {children}
    </main>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  navigationState.pathname = '/tools/password';
  vi.clearAllMocks();
});

describe('mobile Tools layout', () => {
  it('shows the active tool and reserves space for mobile navigation', () => {
    render(
      <Layout>
        <div>Password workspace</div>
      </Layout>,
    );

    expect(screen.getByRole('heading', { name: 'password.title' })).toBeTruthy();
    expect(screen.getByText('Password workspace')).toBeTruthy();

    const content = screen.getByRole('main');
    expect(content.getAttribute('data-padding')).toBe('12');
    expect(content.getAttribute('data-with-nav')).toBe('true');
  });

  it('opens the controlled drawer with the active item selected', () => {
    render(
      <Layout>
        <div>Password workspace</div>
      </Layout>,
    );

    const navigationButton = screen.getByRole('button', { name: 'navigation' });
    expect(navigationButton.getAttribute('aria-controls')).toBe('mobile-tools-navigation');
    expect(navigationButton.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(navigationButton);

    const drawer = screen.getByRole('dialog', { name: 'title' });
    expect(navigationButton.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.querySelector('[role="menu"]')?.getAttribute('data-selected-keys')).toBe(
      'password',
    );
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'picbed.title',
      'password.title',
      'apitest.title',
    ]);
  });

  it('navigates to the selected tool and closes the drawer', () => {
    render(
      <Layout>
        <div>Password workspace</div>
      </Layout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'navigation' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'apitest.title' }));

    expect(pushMock).toHaveBeenCalledWith('/tools/apitest');
    expect(screen.queryByRole('dialog', { name: 'title' })).toBeNull();
    expect(screen.getByRole('button', { name: 'navigation' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('closes the drawer without changing routes', () => {
    render(
      <Layout>
        <div>Password workspace</div>
      </Layout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));

    expect(screen.queryByRole('dialog', { name: 'title' })).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('falls back to Picbed for the Tools root route', () => {
    navigationState.pathname = '/tools';

    render(
      <Layout>
        <div>Tools workspace</div>
      </Layout>,
    );

    expect(screen.getByRole('heading', { name: 'picbed.title' })).toBeTruthy();
  });
});
