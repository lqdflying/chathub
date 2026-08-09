import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import {
  Provider,
  createServerConfigStore,
  initServerConfigStore,
} from '@/store/serverConfig/store';

import NavBar from './NavBar';

const { navigationState, pushMock } = vi.hoisted(() => ({
  navigationState: {
    activeTabKey: 'image',
    pathname: '/image',
  },
  pushMock: vi.fn(),
}));

beforeAll(() => {
  initServerConfigStore({
    featureFlags: {
      ...mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
      enableKnowledgeBase: true,
      showAiImage: true,
    },
  });
});

afterEach(() => {
  act(() => {
    createServerConfigStore().setState({
      featureFlags: {
        ...createServerConfigStore().getState().featureFlags,
        enableKnowledgeBase: true,
        showAiImage: true,
      },
    });
  });
  navigationState.activeTabKey = 'image';
  navigationState.pathname = '/image';
  cleanup();
  vi.clearAllMocks();
});

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/useActiveTabKey', () => ({
  useActiveTabKey: () => navigationState.activeTabKey,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span />,
}));

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

vi.mock('@lobehub/ui/mobile', () => ({
  TabBar: ({ activeKey, items }: any) => (
    <nav data-active-key={activeKey}>
      {items.map((item: any) => (
        <button key={item.key} onClick={item.onClick} type="button">
          {item.title}
        </button>
      ))}
    </nav>
  ),
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderNavBar = () =>
  render(
    <Provider createStore={createServerConfigStore}>
      <NavBar />
    </Provider>,
  );

describe('mobile NavBar', () => {
  it('renders five destinations in order and opens the direct routes', () => {
    renderNavBar();

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'tab.chat',
      'tab.aiImage',
      'tab.artifacts',
      'tab.me',
      'tab.more',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'tab.aiImage' }));
    expect(pushMock).toHaveBeenCalledWith('/image');
    fireEvent.click(screen.getByRole('button', { name: 'tab.artifacts' }));
    expect(pushMock).toHaveBeenCalledWith('/artifacts');
  });

  it.each(['/knowledge', '/knowledge/bases/base-id', '/tools', '/tools/apitest'])(
    'selects More on the nested route family %s',
    (pathname) => {
      navigationState.activeTabKey = pathname.split('/').find(Boolean) || '';
      navigationState.pathname = pathname;

      renderNavBar();

      expect(screen.getByRole('navigation').getAttribute('data-active-key')).toBe('more');
    },
  );

  it('opens the More drawer, selects the current family, and closes after navigation', () => {
    navigationState.activeTabKey = 'tools';
    navigationState.pathname = '/tools/apitest';

    renderNavBar();
    fireEvent.click(screen.getByRole('button', { name: 'tab.more' }));

    const drawer = screen.getByRole('dialog', { name: 'tab.more' });
    expect(drawer.querySelector('[role="menu"]')?.getAttribute('data-selected-keys')).toBe(
      'tools',
    );
    expect(screen.getByRole('menuitem', { name: 'tab.knowledgeBase' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'tab.tools' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'tab.knowledgeBase' }));
    expect(pushMock).toHaveBeenCalledWith('/knowledge');
    expect(screen.queryByRole('dialog', { name: 'tab.more' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'tab.more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'tab.tools' }));
    expect(pushMock).toHaveBeenCalledWith('/tools');
    expect(screen.queryByRole('dialog', { name: 'tab.more' })).toBeNull();
  });

  it('closes the More drawer without navigating', () => {
    renderNavBar();
    fireEvent.click(screen.getByRole('button', { name: 'tab.more' }));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));

    expect(screen.queryByRole('dialog', { name: 'tab.more' })).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('hides Image when image generation is disabled', () => {
    act(() => {
      createServerConfigStore().setState({
        featureFlags: {
          ...createServerConfigStore().getState().featureFlags,
          showAiImage: false,
        },
      });
    });

    renderNavBar();

    expect(screen.queryByRole('button', { name: 'tab.aiImage' })).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'tab.chat',
      'tab.artifacts',
      'tab.me',
      'tab.more',
    ]);
  });

  it('hides Knowledge Base in More when the feature is disabled', () => {
    act(() => {
      createServerConfigStore().setState({
        featureFlags: {
          ...createServerConfigStore().getState().featureFlags,
          enableKnowledgeBase: false,
        },
      });
    });

    renderNavBar();
    fireEvent.click(screen.getByRole('button', { name: 'tab.more' }));

    expect(screen.queryByRole('menuitem', { name: 'tab.knowledgeBase' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'tab.tools' })).toBeTruthy();
  });
});
