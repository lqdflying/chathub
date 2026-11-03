/** @vitest-environment happy-dom */
import type { SandboxProfileItem } from '@lobechat/types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: {
    create: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    prepare: vi.fn(),
    settings: vi.fn(),
    update: vi.fn(),
  },
  cancelJob: vi.fn(),
  confirm: vi.fn(),
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

// Light stand-ins: a Settings group renders its title, description, header
// controls and rows; a dropdown renders its items as buttons.
vi.mock('@lobehub/ui', () => {
  const button = ({ children, disabled, loading, onClick, ...rest }: any) => (
    <button
      aria-label={rest['aria-label']}
      data-loading={loading ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
  const row = (item: any, index: number) =>
    item.hidden ? null : (
      <div data-layout={item.layout} key={item.key ?? index}>
        {item.label && <span data-slot="label">{item.label}</span>}
        {item.desc && <span>{item.desc}</span>}
        {item.children}
        {item.help && <span>{item.help}</span>}
      </div>
    );
  return {
    ActionIcon: ({ disabled, onClick, ...rest }: any) => (
      <button
        aria-label={rest['aria-label']}
        disabled={disabled}
        onClick={(event) => onClick?.(event)}
        type="button"
      />
    ),
    Alert: ({ message }: any) => <div role="alert">{message}</div>,
    Avatar: () => null,
    Button: button,
    Dropdown: ({ children, menu }: any) => (
      <div>
        {children}
        {menu.items
          .filter((item: any) => item.type !== 'divider')
          .map((item: any) => (
            <button disabled={item.disabled} key={item.key} onClick={item.onClick} type="button">
              {`menu:${item.label}`}
            </button>
          ))}
      </div>
    ),
    Form: ({ items }: any) => (
      <div>
        {items.map((group: any, index: number) => (
          <section key={group.key ?? index}>
            <div>{group.title}</div>
            {group.desc && <div>{group.desc}</div>}
            <div>{group.extra}</div>
            {Array.isArray(group.children) ? group.children.map(row) : group.children}
          </section>
        ))}
      </div>
    ),
    Icon: () => null,
    Modal: ({
      children,
      footer,
      keyboard,
      maskClosable,
      okText,
      onCancel,
      onOk,
      open,
      title,
    }: any) =>
      open ? (
        <div
          data-keyboard={String(keyboard)}
          data-mask-closable={String(maskClosable)}
          role="dialog"
        >
          <h3>{title}</h3>
          {children}
          {footer === undefined ? (
            <>
              <button onClick={onOk} type="button">
                {okText}
              </button>
              <button onClick={onCancel} type="button">
                modal:close
              </button>
            </>
          ) : (
            footer
          )}
        </div>
      ) : null,
    Tag: ({ children }: any) => <span>{children}</span>,
  };
});
vi.mock('antd', () => ({
  // Confirming runs the action, so a test sees the effect of a confirmed delete.
  App: { useApp: () => ({ modal: { confirm: mocks.confirm } }) },
  Button: ({ children, disabled, onClick, ...rest }: any) => (
    <button aria-label={rest['aria-label']} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Input: Object.assign(
    ({ onChange, value, ...rest }: any) => (
      <input
        aria-label={rest['aria-label']}
        onChange={onChange}
        placeholder={rest.placeholder}
        value={value}
      />
    ),
    {
      TextArea: ({ onChange, value, ...rest }: any) => (
        <textarea aria-label={rest['aria-label']} onChange={onChange} value={value} />
      ),
    },
  ),
  Modal: ({ children, okText, onCancel, onOk, open, title }: any) =>
    open ? (
      <div role="dialog">
        <h3>{title}</h3>
        {children}
        <button onClick={onOk} type="button">
          {okText}
        </button>
        <button onClick={onCancel} type="button">
          modal:close
        </button>
      </div>
    ) : null,
  Select: ({ onChange, options, value, ...rest }: any) => (
    <select
      aria-label={rest['aria-label']}
      onChange={(event) => onChange(event.target.value)}
      value={value ?? ''}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
    createProfile: mocks.admin.create,
    deleteProfile: mocks.admin.delete,
    listJobs: mocks.listJobs,
    moveProfile: mocks.admin.move,
    prepareImage: mocks.admin.prepare,
    profileSettings: mocks.admin.settings,
    serverStatus: mocks.serverStatus,
    updateProfile: mocks.admin.update,
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

const settingsItem = (id: string, extra: Record<string, unknown> = {}) => ({
  defaultEnabled: false,
  deletable: id !== 'general',
  description: `${id} description`,
  id,
  imageStatus: 'unknown' as const,
  instructionBase: 'general' as const,
  name: `${id} name`,
  serverId: 'remote',
  updatedAt: '2026-11-02T08:00:00.000Z',
  ...extra,
});

const hubSettings = (profiles = [settingsItem('data')]) => ({
  defaults: {
    cpu: '1',
    egress: { mode: 'open' as const },
    image: 'chathub-sandbox:2',
    jobMaxRuntimeMs: 7_200_000,
    memory: '2Gi',
    readyTimeoutMs: 60_000,
    sessionIdleTimeoutMs: 1_800_000,
    sessionMaxLifetimeMs: 0,
  },
  maxProfiles: 16,
  profiles,
  servers: [
    { id: 'remote', name: 'Remote box', status: 'ok' as const },
    { id: 'spare', name: 'Spare', status: 'misconfigured' as const },
  ],
});

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
    mocks.admin.settings.mockResolvedValue(hubSettings());
    mocks.setEnabled.mockResolvedValue(undefined);
    mocks.setInstruction.mockResolvedValue(undefined);
    mocks.resetInstruction.mockResolvedValue(undefined);
    mocks.confirm.mockImplementation(({ onOk }: { onOk?: () => unknown }) => onOk?.());
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
    fireEvent.click(screen.getAllByText('profile.instruction.view')[0]);
    expect(screen.getByRole('dialog').textContent).toContain('data instruction text');

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
      fireEvent.click(screen.getByText('profile.instruction.view'));
      expect(screen.getByText('profile.instruction.readOnly')).toBeTruthy();
      expect(screen.getByRole('dialog').getAttribute('data-mask-closable')).toBe('true');
      expect(screen.getByRole('dialog').getAttribute('data-keyboard')).toBe('true');

      cleanup();
      mocks.access.mockResolvedValue({ adminsConfigured: false, canEditInstructions: false });
      await renderHub();
      fireEvent.click(screen.getByText('profile.instruction.view'));
      expect(screen.getByText('profile.instruction.readOnlyNoAdmins')).toBeTruthy();
    });

    it('lets an admin edit and save the instruction', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      await renderHub();

      // Reset only appears once the text has been edited.
      expect(screen.queryByText('profile.instruction.reset')).toBeNull();
      fireEvent.click(screen.getByText('profile.instruction.edit'));
      expect(screen.getByRole('dialog').getAttribute('data-mask-closable')).toBe('false');
      expect(screen.getByRole('dialog').getAttribute('data-keyboard')).toBe('false');
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

      fireEvent.click(screen.getByText('profile.instruction.edit'));
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
      const longCommand = `python ${'a'.repeat(180)}.py`;
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
        {
          command: longCommand,
          finishedAt: '2026-11-02T06:30:00.000Z',
          id: 'sjob_long',
          profileId: 'data',
          startedAt: '2026-11-02T06:00:00.000Z',
          status: 'succeeded' as const,
        },
      ]);
      mocks.cancelJob.mockResolvedValue([{ ...running, status: 'cancelled' }]);
      await act(async () => {
        render(<SandboxHub />);
      });

      expect(screen.getByText('jobs.title')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'jobs.refresh' })).toBeTruthy();
      expect(screen.getByText('python train.py')).toBeTruthy();
      expect(screen.getByText('jobs.status.running')).toBeTruthy();
      expect(screen.getAllByText('jobs.status.succeeded')).toHaveLength(2);
      // Each job row names its sandbox first.
      expect(screen.getAllByText(/^data name · jobs\.startedAt/)).toHaveLength(3);
      // A long command is the row content, not the Settings label.
      const command = screen.getByText(longCommand);
      const commandRow = command.closest('[data-layout]');
      expect(commandRow?.getAttribute('data-layout')).toBe('vertical');
      expect(commandRow?.querySelector('[data-slot="label"]')).toBeNull();
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

  describe('profile administration', () => {
    const renderAsAdmin = async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      await act(async () => {
        render(<SandboxHub />);
      });
    };

    it('is not loaded for users who are not admins', async () => {
      mocks.profiles = [profile('data')];
      await act(async () => {
        render(<SandboxHub />);
      });
      expect(mocks.admin.settings).not.toHaveBeenCalled();
      expect(screen.queryByText('admin.addProfile')).toBeNull();
      expect(screen.queryByText('admin.settings')).toBeNull();
    });

    it('shows each profile with its admin controls and the profiles users are not offered', async () => {
      mocks.profiles = [profile('data')];
      mocks.admin.settings.mockResolvedValue(
        hubSettings([
          settingsItem('data', {
            imageStatus: 'ready',
            imageStatusMessage: 'Ready after 3 s.',
          }),
          settingsItem('broken', { issue: 'image: no image and OPENSANDBOX_IMAGE is unset' }),
        ]),
      );
      await renderAsAdmin();

      expect(mocks.admin.settings).toHaveBeenCalledWith('user:u1');
      expect(screen.getByText('admin.addProfile')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'admin.more' })).toHaveLength(2);
      expect(screen.getByText('admin.image.ready')).toBeTruthy();
      expect(screen.getByText(/Ready after 3 s\./)).toBeTruthy();
      expect(screen.getByText('admin.notOffered')).toBeTruthy();
      expect(screen.getByText('broken name')).toBeTruthy();
      expect(screen.getByText(/admin\.issue/).textContent).toContain('no image');

      // Order follows the settings: data is first, broken last.
      const ups = screen.getAllByRole('button', {
        name: 'menu:admin.moveUp',
      }) as HTMLButtonElement[];
      const downs = screen.getAllByRole('button', {
        name: 'menu:admin.moveDown',
      }) as HTMLButtonElement[];
      expect(ups.map((button) => button.disabled)).toEqual([true, false]);
      expect(downs.map((button) => button.disabled)).toEqual([false, true]);
    });

    it('prepares, moves and deletes, then reloads everyone’s profile list', async () => {
      mocks.profiles = [profile('general'), profile('data')];
      mocks.admin.settings.mockResolvedValue(
        hubSettings([settingsItem('general'), settingsItem('data')]),
      );
      mocks.admin.prepare.mockResolvedValue(
        hubSettings([settingsItem('general'), settingsItem('data', { imageStatus: 'ready' })]),
      );
      mocks.admin.move.mockResolvedValue(
        hubSettings([settingsItem('data'), settingsItem('general')]),
      );
      mocks.admin.delete.mockResolvedValue(hubSettings([settingsItem('general')]));
      await renderAsAdmin();
      mocks.load.mockClear();

      await act(async () => {
        fireEvent.click(screen.getAllByText('admin.prepare')[1]);
      });
      expect(mocks.admin.prepare).toHaveBeenCalledWith('user:u1', 'data');
      expect(mocks.load).toHaveBeenCalledWith('user:u1');

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'menu:admin.moveUp' })[1]);
      });
      expect(mocks.admin.move).toHaveBeenCalledWith('user:u1', 'data', 'up');

      // general cannot be deleted, so only data has a delete control.
      expect(screen.getAllByText('menu:admin.delete')).toHaveLength(1);
      await act(async () => {
        fireEvent.click(screen.getByText('menu:admin.delete'));
      });
      expect(mocks.admin.delete).toHaveBeenCalledWith('user:u1', 'data');
    });

    it('shows why an admin change was refused', async () => {
      mocks.profiles = [profile('data')];
      mocks.admin.prepare.mockRejectedValue(new Error('Server "remote" is missing its API key.'));
      await renderAsAdmin();
      await act(async () => {
        fireEvent.click(screen.getByText('admin.prepare'));
      });
      expect(screen.getByText('Server "remote" is missing its API key.')).toBeTruthy();
    });

    it('adds a profile from the form', async () => {
      mocks.profiles = [profile('data')];
      mocks.admin.create.mockResolvedValue(hubSettings());
      await renderAsAdmin();

      await act(async () => {
        fireEvent.click(screen.getByText('admin.addProfile'));
      });
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('admin.form.titleCreate');
      const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(field('admin.form.id'), { target: { value: 'web' } });
      fireEvent.change(field('admin.form.name'), { target: { value: 'Web' } });
      fireEvent.change(field('admin.form.description'), { target: { value: 'Node tooling' } });
      fireEvent.change(field('admin.form.idle'), { target: { value: '60' } });
      fireEvent.change(screen.getByLabelText('admin.form.network'), {
        target: { value: 'allowlist' },
      });
      fireEvent.change(field('admin.form.allowlist'), {
        target: { value: 'registry.npmjs.org' },
      });
      expect(field('admin.form.cpu').placeholder).toContain('"value":"1"');

      await act(async () => {
        fireEvent.click(screen.getByText('admin.form.save'));
      });
      expect(mocks.admin.create).toHaveBeenCalledWith('user:u1', 'web', {
        avatar: null,
        cpu: null,
        defaultEnabled: false,
        description: 'Node tooling',
        egress: ['registry.npmjs.org'],
        image: null,
        instructionBase: 'general',
        instructionText: null,
        jobMaxRuntimeMs: null,
        memory: null,
        name: 'Web',
        readyTimeoutMs: null,
        serverId: 'remote',
        sessionIdleTimeoutMs: 3_600_000,
        sessionMaxLifetimeMs: null,
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the form open with the field or server error', async () => {
      mocks.profiles = [profile('data')];
      mocks.admin.update.mockRejectedValue(new Error('Server "spare" is missing its API key.'));
      await renderAsAdmin();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'admin.settings' }));
      });
      expect(screen.getByRole('dialog').textContent).toContain('admin.form.changeWarning');
      fireEvent.change(screen.getByLabelText('admin.form.idle'), { target: { value: '-5' } });
      await act(async () => {
        fireEvent.click(screen.getByText('admin.form.save'));
      });
      expect(screen.getByText('admin.form.invalid.idleMinutes')).toBeTruthy();
      expect(mocks.admin.update).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('admin.form.idle'), { target: { value: '' } });
      await act(async () => {
        fireEvent.click(screen.getByText('admin.form.save'));
      });
      expect(mocks.admin.update).toHaveBeenCalledWith(
        'user:u1',
        'data',
        expect.objectContaining({ name: 'data name', serverId: 'remote' }),
      );
      expect(screen.getByText('Server "spare" is missing its API key.')).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });
});
