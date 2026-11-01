/** @vitest-environment happy-dom */
import type { SandboxProfileItem } from '@lobechat/types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  profiles: [] as SandboxProfileItem[],
  scope: 'user:u1' as string | undefined,
  serverStatus: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => null,
}));
vi.mock('antd', () => ({
  Switch: ({ checked, disabled, onChange, ...rest }: any) => (
    <button
      aria-label={rest['aria-label']}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      type="button"
    />
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('antd-style', () => ({ createStyles: () => () => ({ styles: {} }) }));
vi.mock('react-layout-kit', () => ({ Flexbox: ({ children }: any) => <div>{children}</div> }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('@/services/sandboxHub', () => ({
  sandboxHubService: { serverStatus: mocks.serverStatus },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: any) => unknown) =>
    selector({ isUserStateInit: true, userStateScope: mocks.scope }),
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: any) => unknown) =>
    selector({
      loadSandboxProfiles: mocks.load,
      sandboxProfiles: mocks.profiles,
      sandboxProfilesScope: mocks.profiles.length > 0 ? 'user:u1' : undefined,
      setSandboxProfileEnabled: mocks.setEnabled,
    }),
}));

const { default: SandboxHub } = await import('./index');

const profile = (id: string, extra: Partial<SandboxProfileItem> = {}): SandboxProfileItem => ({
  available: true,
  cpu: '2',
  defaultEnabled: false,
  description: `${id} description`,
  egress: { mode: 'allowlist', targets: ['pypi.org'] },
  enabled: false,
  id,
  identifier: `lobe-sandbox--${id}`,
  instruction: `${id} instruction text`,
  memory: '4Gi',
  name: `${id} name`,
  serverId: 'remote',
  serverName: 'Remote box',
  sessionIdleTimeoutMs: 1_800_000,
  sessionMaxLifetimeMs: 0,
  ...extra,
});

describe('SandboxHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(undefined);
    mocks.serverStatus.mockResolvedValue({ remote: 'ok' });
    mocks.setEnabled.mockResolvedValue(undefined);
    mocks.scope = 'user:u1';
  });
  afterEach(() => cleanup());

  it('loads the profiles for the signed-in account and shows the empty state', async () => {
    mocks.profiles = [];
    await act(async () => {
      render(<SandboxHub />);
    });
    expect(mocks.load).toHaveBeenCalledWith('user:u1');
    expect(mocks.serverStatus).toHaveBeenCalledWith('user:u1');
  });

  it('shows each profile with its limits, network, server status and instruction', async () => {
    mocks.profiles = [profile('data', { enabled: true }), profile('locked', { available: false })];
    await act(async () => {
      render(<SandboxHub />);
    });

    expect(screen.getByText('data name')).toBeTruthy();
    expect(screen.getAllByText('health.ok')).toHaveLength(2);
    expect(screen.getAllByText(/profile\.egress\.allowlist/)[0].textContent).toContain('"count":1');
    expect(screen.getAllByText(/profile\.idle/)[0].textContent).toContain('30 min');
    expect(screen.getByText('profile.unavailable')).toBeTruthy();

    expect(screen.queryByText('data instruction text')).toBeNull();
    fireEvent.click(screen.getAllByText('profile.showInstruction')[0]);
    expect(screen.getByText('data instruction text')).toBeTruthy();

    const locked = screen.getByRole('button', { name: /locked name/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
  });

  it('turns a profile on or off through the store', async () => {
    mocks.profiles = [profile('data')];
    await act(async () => {
      render(<SandboxHub />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /data name/ }));
    });
    expect(mocks.setEnabled).toHaveBeenCalledWith('data', true);
  });
});
