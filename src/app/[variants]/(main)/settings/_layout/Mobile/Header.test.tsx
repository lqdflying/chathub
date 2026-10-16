import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import Header from './Header';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  activeId: undefined as string | undefined,
  providerName: 'openai' as string | null,
  push: vi.fn(),
  setActive: vi.fn(),
  setProviderName: vi.fn(),
  showMobileWorkspace: false,
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: Object.assign(
    ({ center, onBackClick }: { center?: React.ReactNode; onBackClick?: () => void }) => (
      <header>
        <button onClick={onBackClick} type="button">
          back
        </button>
        {center}
      </header>
    ),
    {
      Title: ({ title }: { title?: React.ReactNode }) => <span>{title}</span>,
    },
  ),
}));

vi.mock('nuqs', () => ({
  useQueryState: (key: string) =>
    key === 'provider'
      ? [mocks.providerName, mocks.setProviderName]
      : ['provider', mocks.setActive],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({ push: mocks.push }),
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({
  useShowMobileWorkspace: () => mocks.showMobileWorkspace,
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { activeId?: string }) => unknown) =>
    selector({ activeId: mocks.activeId }),
}));

const renderHeader = () => render(<Header activeSettingsKey={SettingsTabs.Provider} />);

describe('mobile settings header provider back', () => {
  beforeEach(() => {
    mocks.activeId = undefined;
    mocks.providerName = 'openai';
    mocks.showMobileWorkspace = false;
    mocks.push.mockReset();
    mocks.setActive.mockReset();
    mocks.setProviderName.mockReset();
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    window.history.replaceState(null, '', '/settings?active=provider&provider=openai');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/settings?active=provider');
  });

  it('pops a detail entry that this visit pushed', () => {
    window.history.replaceState(
      { __NA: true, chathubProviderDetail: 'openai' },
      '',
      '/settings?active=provider&provider=openai',
    );
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(window.history.back).toHaveBeenCalledOnce();
    expect(mocks.setProviderName).not.toHaveBeenCalled();
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it('pops a detail entry before the provider id is shown', () => {
    mocks.providerName = null;
    window.history.replaceState(
      { chathubProviderDetail: 'openai' },
      '',
      '/settings?active=provider&provider=openai',
    );
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(window.history.back).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.setProviderName).not.toHaveBeenCalled();
  });

  it('clears the provider query for a direct visit that did not push a detail entry', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mocks.setProviderName).toHaveBeenCalledWith(null);
    expect(mocks.setActive).toHaveBeenCalledWith('provider');
  });
});
