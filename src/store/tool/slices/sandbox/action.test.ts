import type { SandboxProfileItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';
import { builtinTools } from '@/tools';
import { SandboxManifest } from '@/tools/sandbox';

import { useToolStore } from '../../store';
import { composeBuiltinTools } from './action';

const service = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  setProfileEnabled: vi.fn(),
}));

vi.mock('@/services/sandboxHub', () => ({ sandboxHubService: service }));

const item = (id: string, extra: Partial<SandboxProfileItem> = {}): SandboxProfileItem => ({
  available: true,
  avatar: SandboxManifest.meta.avatar,
  cpu: '1',
  defaultEnabled: id === 'general',
  description: id === 'general' ? (SandboxManifest.meta.description as string) : `${id} profile`,
  egress: { mode: 'open' },
  enabled: true,
  id,
  identifier: id === 'general' ? 'lobe-sandbox' : `lobe-sandbox--${id}`,
  instruction: id === 'general' ? SandboxManifest.systemRole : `${id} instruction`,
  instructionCustomized: false,
  memory: '2Gi',
  name: id === 'general' ? (SandboxManifest.meta.title as string) : id,
  serverId: 'default',
  serverName: 'Default',
  sessionIdleTimeoutMs: 1_800_000,
  sessionMaxLifetimeMs: 0,
  ...extra,
});

describe('Sandbox Hub tool-store slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolStore.setState({ builtinTools, sandboxProfiles: [], sandboxProfilesScope: undefined });
    useUserStore.setState({ isUserStateInit: true, userStateScope: 'user:a' } as never);
  });

  it('appends one tool per enabled, runnable profile after the static builtins', () => {
    const tools = composeBuiltinTools([
      item('general'),
      item('data'),
      item('off', { enabled: false }),
      item('locked', { available: false }),
    ]);
    expect(tools.slice(0, builtinTools.length)).toEqual(builtinTools);
    expect(tools.slice(builtinTools.length).map((tool) => tool.identifier)).toEqual([
      'lobe-sandbox',
      'lobe-sandbox--data',
    ]);
    // The general profile from OPENSANDBOX_* is the old static manifest.
    expect(tools[builtinTools.length].manifest).toEqual(SandboxManifest);
  });

  it('applies a list only for the account it was fetched for', async () => {
    service.listProfiles.mockImplementation(async () => {
      useUserStore.setState({ userStateScope: 'user:b' } as never);
      return [item('general')];
    });
    await useToolStore.getState().loadSandboxProfiles('user:a');
    expect(useToolStore.getState().sandboxProfiles).toEqual([]);
    expect(useToolStore.getState().builtinTools).toBe(builtinTools);
  });

  it('loads once per account before a send and after a toggle uses the returned list', async () => {
    service.listProfiles.mockResolvedValue([item('general')]);
    await useToolStore.getState().ensureSandboxProfiles();
    await useToolStore.getState().ensureSandboxProfiles();
    expect(service.listProfiles).toHaveBeenCalledTimes(1);
    expect(useToolStore.getState().sandboxProfilesScope).toBe('user:a');

    service.setProfileEnabled.mockResolvedValue([item('general', { enabled: false })]);
    await useToolStore.getState().setSandboxProfileEnabled('general', false);
    expect(service.setProfileEnabled).toHaveBeenCalledWith('user:a', 'general', false);
    expect(
      useToolStore.getState().builtinTools.some((tool) => tool.identifier === 'lobe-sandbox'),
    ).toBe(false);
  });

  it('keeps a saved toggle when an older profile list returns later', async () => {
    let resolveList: (profiles: SandboxProfileItem[]) => void = () => undefined;
    service.listProfiles.mockReturnValue(
      new Promise<SandboxProfileItem[]>((resolve) => {
        resolveList = resolve;
      }),
    );
    const loading = useToolStore.getState().loadSandboxProfiles('user:a');
    service.setProfileEnabled.mockResolvedValue([item('general', { enabled: false })]);
    await useToolStore.getState().setSandboxProfileEnabled('general', false);
    resolveList([item('general', { enabled: true })]);
    await loading;
    expect(useToolStore.getState().sandboxProfiles).toEqual([item('general', { enabled: false })]);
  });

  it('fetches from the hook only when enabled', async () => {
    service.listProfiles.mockResolvedValue([item('general')]);
    const { rerender } = renderHook(
      ({ on }) => useToolStore.getState().useFetchSandboxProfiles(on),
      {
        initialProps: { on: false },
      },
    );
    expect(service.listProfiles).not.toHaveBeenCalled();
    await act(async () => rerender({ on: true }));
    expect(service.listProfiles).toHaveBeenCalledWith('user:a');
  });
});
