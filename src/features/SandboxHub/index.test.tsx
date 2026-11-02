/** @vitest-environment happy-dom */
import type { SandboxProfileItem } from '@lobechat/types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  cancelJob: vi.fn(),
  initFailed: false,
  listJobs: vi.fn(),
  load: vi.fn(),
  loadedScope: 'user:u1' as string | undefined,
  profiles: [] as SandboxProfileItem[],
  scope: 'user:u1' as string | undefined,
  resetInstruction: vi.fn(),
  serverStatus: vi.fn(),
  setEnabled: vi.fn(),
  setInstruction: vi.fn(),
  userReady: true,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => null,
}));
vi.mock('antd', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Input: {
    TextArea: ({ onChange, value, ...rest }: any) => (
      <textarea aria-label={rest['aria-label']} onChange={onChange} value={value} />
    ),
  },
  Popconfirm: ({ children, okText, onConfirm }: any) => (
    <span>
      {children}
      <button onClick={onConfirm} type="button">{`confirm:${okText}`}</button>
    </span>
  ),
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
  sandboxHubService: {
    access: mocks.access,
    cancelJob: mocks.cancelJob,
    listJobs: mocks.listJobs,
    serverStatus: mocks.serverStatus,
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: any) => unknown) =>
    selector({
      isUserStateInit: mocks.userReady,
      userStateInitializationFailure: mocks.initFailed
        ? { reason: 'request-failed', scope: 'user:u1' }
        : undefined,
      userStateScope: mocks.scope,
    }),
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: any) => unknown) =>
    selector({
      loadSandboxProfiles: mocks.load,
      resetSandboxProfileInstruction: mocks.resetInstruction,
      sandboxProfiles: mocks.profiles,
      sandboxProfilesScope: mocks.loadedScope,
      setSandboxProfileEnabled: mocks.setEnabled,
      setSandboxProfileInstruction: mocks.setInstruction,
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
  instructionCustomized: false,
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
    mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: false });
    mocks.listJobs.mockResolvedValue([]);
    mocks.setEnabled.mockResolvedValue(undefined);
    mocks.setInstruction.mockResolvedValue(undefined);
    mocks.resetInstruction.mockResolvedValue(undefined);
    mocks.scope = 'user:u1';
    mocks.loadedScope = 'user:u1';
    mocks.userReady = true;
    mocks.initFailed = false;
  });
  afterEach(() => cleanup());

  it('loads the profiles for the signed-in account and shows the empty state', async () => {
    mocks.profiles = [];
    await act(async () => {
      render(<SandboxHub />);
    });
    expect(mocks.load).toHaveBeenCalledWith('user:u1');
    expect(mocks.serverStatus).toHaveBeenCalledWith('user:u1');
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('shows loading until the account is ready, and an error if that init failed', async () => {
    mocks.scope = undefined;
    mocks.userReady = false;
    mocks.profiles = [];
    await act(async () => {
      render(<SandboxHub />);
    });
    expect(screen.getByText('loading')).toBeTruthy();
    expect(screen.queryByText('empty')).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();

    cleanup();
    mocks.initFailed = true;
    await act(async () => {
      render(<SandboxHub />);
    });
    expect(screen.getByText('loadFailed')).toBeTruthy();
    expect(screen.queryByText('empty')).toBeNull();
  });

  it('shows each profile with its limits, network, server status and instruction', async () => {
    mocks.profiles = [
      profile('data', { enabled: true }),
      profile('locked', { available: false }),
      profile('broken', { available: false, enabled: true }),
    ];
    await act(async () => {
      render(<SandboxHub />);
    });

    expect(screen.getByText('data name')).toBeTruthy();
    expect(screen.getAllByText('health.ok')).toHaveLength(3);
    expect(screen.getAllByText(/profile\.egress\.allowlist/)[0].textContent).toContain('"count":1');
    expect(screen.getAllByText(/profile\.idle/)[0].textContent).toContain(
      'profile.duration.minutes',
    );
    expect(screen.getAllByText(/profile\.idle/)[0].textContent).toContain('30');
    expect(screen.getAllByText('profile.unavailable')).toHaveLength(2);

    expect(screen.queryByText('data instruction text')).toBeNull();
    fireEvent.click(screen.getAllByText('profile.showInstruction')[0]);
    expect(screen.getByText('data instruction text')).toBeTruthy();

    const locked = screen.getByRole('button', { name: /locked name/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    const broken = screen.getByRole('button', { name: /broken name/ }) as HTMLButtonElement;
    expect(broken.disabled).toBe(false);
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

  describe('instruction editing', () => {
    const renderHub = async () => {
      await act(async () => {
        render(<SandboxHub />);
      });
    };

    it('keeps instructions read-only for non-admins and says who can edit', async () => {
      mocks.profiles = [profile('data')];
      await renderHub();
      expect(mocks.access).toHaveBeenCalledWith('user:u1');
      expect(screen.queryByText('profile.instruction.edit')).toBeNull();
      fireEvent.click(screen.getByText('profile.showInstruction'));
      expect(screen.getByText('profile.instruction.readOnly')).toBeTruthy();

      cleanup();
      mocks.access.mockResolvedValue({ adminsConfigured: false, canEditInstructions: false });
      await renderHub();
      fireEvent.click(screen.getByText('profile.showInstruction'));
      expect(screen.getByText('profile.instruction.readOnlyNoAdmins')).toBeTruthy();
    });

    it('lets an admin edit and save the instruction', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      await renderHub();

      // Reset only appears once the text has been edited.
      expect(screen.queryByText('profile.instruction.reset')).toBeNull();
      fireEvent.click(screen.getByText('profile.instruction.edit'));
      const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(editor.value).toBe('data instruction text');

      const save = () => screen.getByText('profile.instruction.save') as HTMLButtonElement;
      expect(save().disabled).toBe(true);
      fireEvent.change(editor, { target: { value: 'Today is {{date}}.' } });
      expect(screen.getByText(/profile\.instruction\.placeholderWarning/)).toBeTruthy();
      expect(save().disabled).toBe(false);

      await act(async () => {
        fireEvent.click(save());
      });
      expect(mocks.setInstruction).toHaveBeenCalledWith('data', 'Today is {{date}}.');
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('keeps the draft and shows an error when saving fails', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.setInstruction.mockRejectedValue(new Error('FORBIDDEN'));
      mocks.profiles = [profile('data')];
      await renderHub();
      fireEvent.click(screen.getByText('profile.instruction.edit'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New text.' } });
      await act(async () => {
        fireEvent.click(screen.getByText('profile.instruction.save'));
      });
      expect(screen.getByText('profile.instruction.saveFailed')).toBeTruthy();
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('New text.');
    });

    it('blocks saving an instruction over 32 KiB', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      await renderHub();
      fireEvent.click(screen.getByText('profile.instruction.edit'));
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'x'.repeat(32 * 1024 + 1) },
      });
      expect(screen.getByText(/profile\.instruction\.tooLarge/)).toBeTruthy();
      expect((screen.getByText('profile.instruction.save') as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    it('shows when an edit was made and resets it after confirmation', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [
        profile('data', {
          instruction: 'Edited.',
          instructionCustomized: true,
          instructionUpdatedAt: '2026-11-01T08:00:00.000Z',
        }),
      ];
      await renderHub();
      expect(screen.getByText('profile.instruction.customized')).toBeTruthy();
      expect(screen.getByText(/profile\.instruction\.updatedAt/)).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByText('confirm:profile.instruction.reset'));
      });
      expect(mocks.resetInstruction).toHaveBeenCalledWith('data');
    });
  });

  describe('background jobs', () => {
    const running = {
      command: 'python train.py',
      id: 'sjob_1',
      profileId: 'data',
      startedAt: '2026-11-02T08:00:00.000Z',
      status: 'running' as const,
    };

    it('stays hidden until the user has a job', async () => {
      mocks.profiles = [profile('data')];
      await act(async () => {
        render(<SandboxHub />);
      });
      expect(mocks.listJobs).toHaveBeenCalledWith('user:u1');
      expect(screen.queryByText('jobs.title')).toBeNull();
    });

    it('lists jobs with their profile and cancels a running one', async () => {
      mocks.profiles = [profile('data')];
      mocks.listJobs.mockResolvedValue([
        running,
        {
          command: 'make',
          exitCode: 0,
          finishedAt: '2026-11-02T07:30:00.000Z',
          id: 'sjob_0',
          profileId: 'data',
          startedAt: '2026-11-02T07:00:00.000Z',
          status: 'succeeded' as const,
        },
      ]);
      mocks.cancelJob.mockResolvedValue([{ ...running, status: 'cancelled' }]);
      await act(async () => {
        render(<SandboxHub />);
      });

      expect(screen.getByText('jobs.title')).toBeTruthy();
      expect(screen.getByText('python train.py')).toBeTruthy();
      expect(screen.getByText('jobs.status.running')).toBeTruthy();
      expect(screen.getByText('jobs.status.succeeded')).toBeTruthy();
      expect(screen.getAllByText('data name').length).toBeGreaterThan(1);
      expect(screen.getByText(/jobs\.exitCode/).textContent).toContain('"code":0');
      // Only the running job can be cancelled.
      expect(screen.getAllByText('confirm:jobs.cancel')).toHaveLength(1);

      await act(async () => {
        fireEvent.click(screen.getByText('confirm:jobs.cancel'));
      });
      expect(mocks.cancelJob).toHaveBeenCalledWith('user:u1', 'sjob_1');
      expect(screen.getByText('jobs.status.cancelled')).toBeTruthy();
      expect(screen.queryByText('confirm:jobs.cancel')).toBeNull();
    });

    it('says when cancelling fails', async () => {
      mocks.profiles = [profile('data')];
      mocks.listJobs.mockResolvedValue([running]);
      mocks.cancelJob.mockRejectedValue(new Error('NOT_FOUND'));
      await act(async () => {
        render(<SandboxHub />);
      });
      await act(async () => {
        fireEvent.click(screen.getByText('confirm:jobs.cancel'));
      });
      expect(screen.getByText('jobs.cancelFailed')).toBeTruthy();
    });
  });
});
