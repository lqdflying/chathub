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

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

beforeAll(() => {
  initServerConfigStore({
    featureFlags: {
      ...mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
      showAiImage: true,
    },
  });
});

afterEach(() => {
  act(() => {
    createServerConfigStore().setState({
      featureFlags: {
        ...createServerConfigStore().getState().featureFlags,
        showAiImage: true,
      },
    });
  });
  cleanup();
  vi.clearAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/useActiveTabKey', () => ({
  useActiveTabKey: () => 'image',
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span />,
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
  it('renders Chat, Image, Artifacts, and Me in order and opens the top-level routes', () => {
    renderNavBar();

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'tab.chat',
      'tab.aiImage',
      'tab.artifacts',
      'tab.me',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'tab.aiImage' }));
    expect(pushMock).toHaveBeenCalledWith('/image');
    fireEvent.click(screen.getByRole('button', { name: 'tab.artifacts' }));
    expect(pushMock).toHaveBeenCalledWith('/artifacts');
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
    ]);
  });
});
