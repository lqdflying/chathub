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
  fetchPreset: vi.fn(),
  files: {
    deleteMine: vi.fn(),
    deleteShared: vi.fn(),
    list: vi.fn(),
    setMine: vi.fn(),
    setShared: vi.fn(),
  },
  env: {
    deleteMine: vi.fn(),
    deleteShared: vi.fn(),
    list: vi.fn(),
    setMine: vi.fn(),
    setShared: vi.fn(),
  },
  initFailed: false,
  listHubJobs: vi.fn(),
  purgeFinishedJobs: vi.fn(),
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
        aria-label={rest['aria-label'] ?? rest.title}
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
  Checkbox: ({ checked, children, onChange }: any) => (
    <label>
      <input
        checked={checked}
        onChange={(event) => onChange({ target: { checked: event.target.checked } })}
        type="checkbox"
      />
      {children}
    </label>
  ),
  Button: ({ children, disabled, onClick, ...rest }: any) => (
    <button aria-label={rest['aria-label']} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Input: Object.assign(
    ({ onChange, value, ...rest }: any) => (
      <input
        aria-label={rest['aria-label']}
        data-status={rest.status}
        inputMode={rest.inputMode}
        onChange={onChange}
        placeholder={rest.placeholder}
        value={value}
      />
    ),
    {
      Password: ({ onChange, value, ...rest }: any) => (
        <input
          aria-label={rest['aria-label']}
          onChange={onChange}
          placeholder={rest.placeholder}
          type="password"
          value={value}
        />
      ),
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
  // Choosing a file calls beforeUpload with it, as antd does.
  Upload: ({ beforeUpload, children }: any) => (
    <div>
      {children}
      <input
        data-testid="upload-input"
        onChange={(event) => beforeUpload?.(event.target.files?.[0])}
        type="file"
      />
    </div>
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
vi.mock('antd-style', () => ({
  createStyles: () => () => ({ styles: {} }),
  useTheme: () => ({
    colorBgContainer: '#fff',
    colorBorderSecondary: '#ddd',
    colorFillTertiary: '#f5f5f5',
  }),
}));
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
    deleteMyEnv: mocks.env.deleteMine,
    deleteMyFile: mocks.files.deleteMine,
    deleteProfile: mocks.admin.delete,
    deleteSharedEnv: mocks.env.deleteShared,
    deleteSharedFile: mocks.files.deleteShared,
    listEnvs: mocks.env.list,
    listFiles: mocks.files.list,
    listHubJobs: mocks.listHubJobs,
    purgeFinishedJobs: mocks.purgeFinishedJobs,
    moveProfile: mocks.admin.move,
    prepareImage: mocks.admin.prepare,
    profileSettings: mocks.admin.settings,
    serverStatus: mocks.serverStatus,
    setMyEnv: mocks.env.setMine,
    setMyFile: mocks.files.setMine,
    setSharedEnv: mocks.env.setShared,
    setSharedFile: mocks.files.setShared,
    updateProfile: mocks.admin.update,
  },
}));
vi.mock('@/store/user', () => {
  const useUserStore = Object.assign(
    (selector: (state: any) => unknown) =>
      selector({
        isUserStateInit: mocks.userReady,
        userStateInitializationFailure: mocks.initFailed
          ? { reason: 'request-failed', scope: 'user:u1' }
          : undefined,
        userStateScope: mocks.scope,
      }),
    { getState: () => ({}) },
  );
  return { useUserStore };
});
vi.mock('@/store/user/slices/settings/selectors', () => ({
  systemAgentSelectors: { agentMeta: () => ({}) },
}));
vi.mock('@/services/chat', () => ({
  chatService: { fetchPresetTaskResult: (...args: unknown[]) => mocks.fetchPreset(...args) },
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
    mocks.listHubJobs.mockResolvedValue({
      finished: { items: [], page: 1, pageSize: 20, total: 0 },
      running: [],
    });
    mocks.env.list.mockResolvedValue({ available: true, profiles: {} });
    mocks.files.list.mockResolvedValue({ available: true, profiles: {} });
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
    // The server status shows once, on its server card, not on each sandbox card.
    expect(screen.getByText('servers')).toBeTruthy();
    expect(screen.getAllByText('health.ok')).toHaveLength(1);
    expect(screen.getAllByText(/profile\.egress\.allowlist/)[0].textContent).toContain('"count":1');
    expect(screen.getAllByText(/profile\.idle/)[0].textContent).toContain(
      'profile.duration.minutes',
    );
    expect(screen.getAllByText(/profile\.idle/)[0].textContent).toContain('30');
    expect(screen.getAllByText('profile.unavailable')).toHaveLength(2);

    expect(screen.queryByText('data instruction text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
    fireEvent.click(screen.getByText('profile.instruction.view'));
    expect(screen.getByRole('dialog').textContent).toContain('data instruction text');

    const locked = screen.getByRole('button', {
      name: /profile\.toggle.*locked name/,
    }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    const broken = screen.getByRole('button', {
      name: /profile\.toggle.*broken name/,
    }) as HTMLButtonElement;
    expect(broken.disabled).toBe(false);
    expect(screen.getByRole('button', { name: /profile\.details.*locked name/ })).toBeTruthy();
  });

  it('turns a profile on or off through the store', async () => {
    mocks.profiles = [profile('data')];
    await act(async () => {
      render(<SandboxHub />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /profile\.toggle.*data name/ }));
    });
    expect(mocks.setEnabled).toHaveBeenCalledWith('data', true);
  });

  describe('instruction editing', () => {
    const renderHub = async () => {
      await act(async () => {
        render(<SandboxHub />);
      });
    };
    const openDetails = () =>
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));

    it('keeps instructions read-only for non-admins and says who can edit', async () => {
      mocks.profiles = [profile('data')];
      await renderHub();
      expect(mocks.access).toHaveBeenCalledWith('user:u1');
      expect(screen.queryByText('profile.instruction.edit')).toBeNull();
      openDetails();
      fireEvent.click(screen.getByText('profile.instruction.view'));
      expect(screen.getByText('profile.instruction.readOnly')).toBeTruthy();
      expect(screen.getByRole('dialog').getAttribute('data-mask-closable')).toBe('true');
      expect(screen.getByRole('dialog').getAttribute('data-keyboard')).toBe('true');

      cleanup();
      mocks.access.mockResolvedValue({ adminsConfigured: false, canEditInstructions: false });
      await renderHub();
      openDetails();
      fireEvent.click(screen.getByText('profile.instruction.view'));
      expect(screen.getByText('profile.instruction.readOnlyNoAdmins')).toBeTruthy();
    });

    it('lets an admin edit and save the instruction', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      await renderHub();

      // Reset only appears once the text has been edited.
      expect(screen.queryByText('profile.instruction.reset')).toBeNull();
      openDetails();
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
      openDetails();
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
      openDetails();
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
      openDetails();
      expect(screen.getByText('profile.instruction.customized')).toBeTruthy();
      expect(screen.getByText(/profile\.instruction\.updatedAt/)).toBeTruthy();

      fireEvent.click(screen.getByText('profile.instruction.edit'));
      await act(async () => {
        fireEvent.click(screen.getByText('confirm:profile.instruction.reset'));
      });
      expect(mocks.resetInstruction).toHaveBeenCalledWith('data');
    });
  });

  describe('secret files', () => {
    const file = (path: string, extra: Record<string, unknown> = {}) => ({
      mode: '600',
      path,
      sensitive: true,
      size: 1536,
      updatedAt: '2026-11-02T08:00:00.000Z',
      ...extra,
    });
    const listed = (mine: ReturnType<typeof file>[], shared: ReturnType<typeof file>[]) => ({
      available: true,
      profiles: { data: { mine, shared } },
    });
    const renderHub = async () => {
      await act(async () => {
        render(<SandboxHub />);
      });
    };
    const openFiles = () => {
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
      fireEvent.click(screen.getByText('files.manage'));
    };
    const b64 = (text: string) => Buffer.from(text).toString('base64');

    it('shows the counts and lets a user paste, replace and delete their own file', async () => {
      mocks.profiles = [profile('data')];
      mocks.files.list.mockResolvedValue(listed([], [file('/root/.oci/config')]));
      await renderHub();

      expect(mocks.files.list).toHaveBeenCalledWith('user:u1');
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
      expect(screen.getByText('files.summary:{"mine":0,"shared":1}')).toBeTruthy();
      fireEvent.click(screen.getByText('files.manage'));
      expect(screen.getByText('files.warning')).toBeTruthy();
      // Not an admin: shared paths only, no controls for them.
      expect(screen.getByText('files.sharedReadOnly')).toBeTruthy();
      expect(screen.getAllByText('files.add')).toHaveLength(1);
      expect(screen.queryByText('files.replace')).toBeNull();

      mocks.files.setMine.mockResolvedValue(
        listed([file('/root/.oci/config', { mode: '400' })], [file('/root/.oci/config')]),
      );
      fireEvent.click(screen.getByText('files.add'));
      expect(screen.getByRole('dialog').getAttribute('data-mask-closable')).toBe('false');
      fireEvent.change(screen.getByLabelText('files.path'), {
        target: { value: '/root/.oci/config' },
      });
      fireEvent.click(screen.getByRole('button', { name: '400' }));
      fireEvent.change(screen.getByLabelText('files.content'), {
        target: { value: '[DEFAULT]\nregion=eu-frankfurt-1\n' },
      });
      await act(async () => {
        fireEvent.click(screen.getByText('files.save'));
      });
      expect(mocks.files.setMine).toHaveBeenCalledWith('user:u1', 'data', {
        content: b64('[DEFAULT]\nregion=eu-frankfurt-1\n'),
        mode: '400',
        path: '/root/.oci/config',
        sensitive: true,
      });
      expect(screen.queryByLabelText('files.content')).toBeNull();
      expect(screen.getByText('files.overridden')).toBeTruthy();

      // Replacing a sensitive file keeps its path; empty content changes only the mode.
      fireEvent.click(screen.getByText('files.replace'));
      expect((screen.getByLabelText('files.path') as HTMLInputElement).value).toBe(
        '/root/.oci/config',
      );
      expect((screen.getByLabelText('files.content') as HTMLTextAreaElement).value).toBe('');
      fireEvent.click(screen.getByRole('button', { name: '600' }));
      await act(async () => {
        fireEvent.click(screen.getByText('files.save'));
      });
      expect(mocks.files.setMine).toHaveBeenLastCalledWith('user:u1', 'data', {
        mode: '600',
        path: '/root/.oci/config',
        sensitive: true,
      });

      mocks.files.deleteMine.mockResolvedValue(listed([], [file('/root/.oci/config')]));
      await act(async () => {
        fireEvent.click(screen.getByText('confirm:files.delete'));
      });
      expect(mocks.files.deleteMine).toHaveBeenCalledWith('user:u1', 'data', '/root/.oci/config');
      expect(screen.queryByText('files.overridden')).toBeNull();
    });

    it('uploads a chosen local file as base64', async () => {
      mocks.profiles = [profile('data')];
      mocks.files.setMine.mockResolvedValue(listed([file('/root/.oci/key.pem')], []));
      await renderHub();
      openFiles();

      fireEvent.click(screen.getByText('files.add'));
      fireEvent.change(screen.getByLabelText('files.path'), {
        target: { value: '/root/.oci/key.pem' },
      });
      await act(async () => {
        fireEvent.change(screen.getByTestId('upload-input'), {
          target: { files: [new File(['-----BEGIN KEY-----\nabc\n'], 'key.pem')] },
        });
      });
      expect(screen.getByText(/files\.chosen.*key\.pem/)).toBeTruthy();
      expect(screen.queryByLabelText('files.content')).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByText('files.save'));
      });
      expect(mocks.files.setMine).toHaveBeenCalledWith('user:u1', 'data', {
        content: b64('-----BEGIN KEY-----\nabc\n'),
        mode: '600',
        path: '/root/.oci/key.pem',
        sensitive: true,
      });
    });

    it('does not save while a chosen file is still being read', async () => {
      mocks.profiles = [profile('data')];
      await renderHub();
      openFiles();
      fireEvent.click(screen.getByText('files.add'));
      fireEvent.change(screen.getByLabelText('files.path'), {
        target: { value: '/root/.oci/key.pem' },
      });
      const file = new File(['-----BEGIN KEY-----\n'], 'key.pem');
      let release: (buffer: ArrayBuffer) => void = () => undefined;
      const pending = new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      });
      Object.defineProperty(file, 'arrayBuffer', { value: () => pending });

      await act(async () => {
        fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [file] } });
      });
      const save = screen.getByText('files.save') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.click(save);
      expect(mocks.files.setMine).not.toHaveBeenCalled();

      await act(async () => {
        release(await new File(['-----BEGIN KEY-----\n'], 'key.pem').arrayBuffer());
      });
      expect((screen.getByText('files.save') as HTMLButtonElement).disabled).toBe(false);
    });

    it('checks the path and mode before saving and shows a refused save', async () => {
      mocks.profiles = [profile('data')];
      await renderHub();
      openFiles();
      fireEvent.click(screen.getByText('files.add'));
      fireEvent.change(screen.getByLabelText('files.content'), { target: { value: 'x' } });
      const save = () => screen.getByText('files.save') as HTMLButtonElement;

      fireEvent.change(screen.getByLabelText('files.path'), { target: { value: 'root/.oci' } });
      expect(screen.getByText('files.invalidPath')).toBeTruthy();
      expect(save().disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('files.path'), {
        target: { value: '/tmp/workspace/x' },
      });
      expect(screen.getByText('files.blockedPath')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('files.path'), { target: { value: '/root/x' } });
      fireEvent.change(screen.getByLabelText('files.mode'), { target: { value: '9' } });
      expect(screen.getByText('files.invalidMode')).toBeTruthy();
      expect(save().disabled).toBe(true);

      mocks.files.setMine.mockRejectedValue(new Error('At most 16 files can be set here.'));
      fireEvent.change(screen.getByLabelText('files.mode'), { target: { value: '644' } });
      await act(async () => {
        fireEvent.click(save());
      });
      expect(screen.getByText('At most 16 files can be set here.')).toBeTruthy();
      expect(screen.getByLabelText('files.content')).toBeTruthy();
    });

    it('lets an admin edit a shared file that is not sensitive', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      mocks.files.list.mockResolvedValue(
        listed([], [file('/etc/pip.conf', { content: '[global]\n', sensitive: false })]),
      );
      mocks.files.setShared.mockResolvedValue(
        listed([], [file('/etc/pip.conf', { content: 'x', sensitive: false })]),
      );
      mocks.files.deleteShared.mockResolvedValue(listed([], []));
      await renderHub();
      openFiles();

      expect(screen.getByText('files.sharedHint')).toBeTruthy();
      expect(screen.getByText('files.notSensitive')).toBeTruthy();
      fireEvent.click(screen.getByText('files.replace'));
      const content = screen.getByLabelText('files.content') as HTMLTextAreaElement;
      expect(content.value).toBe('[global]\n');
      fireEvent.change(content, { target: { value: '[global]\nindex-url = https://x\n' } });
      await act(async () => {
        fireEvent.click(screen.getByText('files.save'));
      });
      expect(mocks.files.setShared).toHaveBeenCalledWith('user:u1', 'data', {
        content: b64('[global]\nindex-url = https://x\n'),
        mode: '600',
        path: '/etc/pip.conf',
        sensitive: false,
      });

      await act(async () => {
        fireEvent.click(screen.getByText('confirm:files.delete'));
      });
      expect(mocks.files.deleteShared).toHaveBeenCalledWith('user:u1', 'data', '/etc/pip.conf');
    });

    it('sends cleared visible text and keeps the dialog open when the save is refused', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      mocks.files.list.mockResolvedValue(
        listed([], [file('/etc/pip.conf', { content: '[global]\n', sensitive: false })]),
      );
      mocks.files.setShared.mockRejectedValue(new Error('The file is empty.'));
      await renderHub();
      openFiles();

      fireEvent.click(screen.getByText('files.replace'));
      fireEvent.change(screen.getByLabelText('files.content'), { target: { value: '' } });
      await act(async () => {
        fireEvent.click(screen.getByText('files.save'));
      });
      expect(mocks.files.setShared).toHaveBeenCalledWith('user:u1', 'data', {
        content: '',
        mode: '600',
        path: '/etc/pip.conf',
        sensitive: false,
      });
      expect(screen.getByText('The file is empty.')).toBeTruthy();
      expect(screen.getByLabelText('files.content')).toBeTruthy();
    });
  });

  describe('environment variables', () => {
    const item = (name: string, hint?: string) => ({
      ...(hint ? { hint } : {}),
      name,
      updatedAt: '2026-11-02T08:00:00.000Z',
    });
    const listed = (mine: ReturnType<typeof item>[], shared: ReturnType<typeof item>[]) => ({
      available: true,
      profiles: { data: { mine, shared } },
    });
    const renderHub = async () => {
      await act(async () => {
        render(<SandboxHub />);
      });
    };
    const openEnv = () => {
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
      fireEvent.click(screen.getByText('env.manage'));
    };

    it('shows the counts and lets a user add, replace and delete their own', async () => {
      mocks.profiles = [profile('data')];
      mocks.env.list.mockResolvedValue(listed([], [item('API_TOKEN', '••••1234')]));
      await renderHub();

      expect(mocks.env.list).toHaveBeenCalledWith('user:u1');
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
      expect(screen.getByText('env.summary:{"mine":0,"shared":1}')).toBeTruthy();
      fireEvent.click(screen.getByText('env.manage'));
      expect(screen.getByText('env.warning')).toBeTruthy();
      // Not an admin: shared names only, no controls for them.
      expect(screen.getByText('env.sharedReadOnly')).toBeTruthy();
      expect(screen.getByText('••••1234')).toBeTruthy();
      expect(screen.getAllByText('env.add')).toHaveLength(1);
      expect(screen.queryByText('env.replace')).toBeNull();

      mocks.env.setMine.mockResolvedValue(
        listed([item('API_TOKEN', '••••9876')], [item('API_TOKEN', '••••1234')]),
      );
      fireEvent.click(screen.getByText('env.add'));
      expect(screen.getByRole('dialog').getAttribute('data-mask-closable')).toBe('false');
      fireEvent.change(screen.getByLabelText('env.name'), { target: { value: 'api_token' } });
      const value = screen.getByLabelText('env.value') as HTMLInputElement;
      expect(value.type).toBe('password');
      fireEvent.change(value, { target: { value: 'my-token-9876' } });
      await act(async () => {
        fireEvent.click(screen.getByText('env.save'));
      });
      expect(mocks.env.setMine).toHaveBeenCalledWith(
        'user:u1',
        'data',
        'API_TOKEN',
        'my-token-9876',
        true,
      );
      expect(screen.queryByLabelText('env.value')).toBeNull();
      expect(screen.getByText('env.overridden')).toBeTruthy();

      // Replace keeps the name.
      fireEvent.click(screen.getByText('env.replace'));
      expect((screen.getByLabelText('env.name') as HTMLInputElement).value).toBe('API_TOKEN');
      fireEvent.click(screen.getByText('env.cancel'));

      mocks.env.deleteMine.mockResolvedValue(listed([], [item('API_TOKEN', '••••1234')]));
      await act(async () => {
        fireEvent.click(screen.getByText('confirm:env.delete'));
      });
      expect(mocks.env.deleteMine).toHaveBeenCalledWith('user:u1', 'data', 'API_TOKEN');
      expect(screen.queryByText('env.overridden')).toBeNull();
    });

    it('keeps a save when the env list returns late', async () => {
      let resolveList: (value: ReturnType<typeof listed>) => void = () => undefined;
      mocks.env.list.mockReturnValue(
        new Promise((resolve) => {
          resolveList = resolve;
        }),
      );
      mocks.profiles = [profile('data')];
      await renderHub();
      openEnv();

      mocks.env.setMine.mockResolvedValue(listed([item('API_TOKEN', '••••9876')], []));
      fireEvent.click(screen.getByText('env.add'));
      fireEvent.change(screen.getByLabelText('env.name'), { target: { value: 'API_TOKEN' } });
      fireEvent.change(screen.getByLabelText('env.value'), { target: { value: 'my-token-9876' } });
      await act(async () => {
        fireEvent.click(screen.getByText('env.save'));
      });
      expect(screen.getByText('••••9876')).toBeTruthy();

      await act(async () => {
        resolveList(listed([], []));
      });
      expect(screen.getByText('••••9876')).toBeTruthy();
      expect(screen.queryByText('env.summary:{"mine":0,"shared":0}')).toBeNull();
    });

    it('checks the name before saving and shows a refused save', async () => {
      mocks.profiles = [profile('data')];
      await renderHub();
      openEnv();
      fireEvent.click(screen.getByText('env.add'));
      fireEvent.change(screen.getByLabelText('env.value'), { target: { value: 'x' } });

      fireEvent.change(screen.getByLabelText('env.name'), { target: { value: '1BAD' } });
      expect(screen.getByText('env.invalidName')).toBeTruthy();
      expect((screen.getByText('env.save') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('env.name'), { target: { value: 'PATH' } });
      expect(screen.getByText('env.reservedName:{"name":"PATH"}')).toBeTruthy();

      mocks.env.setMine.mockRejectedValue(new Error('At most 32 variables can be set here.'));
      fireEvent.change(screen.getByLabelText('env.name'), { target: { value: 'TOKEN' } });
      await act(async () => {
        fireEvent.click(screen.getByText('env.save'));
      });
      expect(screen.getByText('At most 32 variables can be set here.')).toBeTruthy();
      expect(screen.getByLabelText('env.value')).toBeTruthy();
    });

    it('lets an admin manage shared variables', async () => {
      mocks.access.mockResolvedValue({ adminsConfigured: true, canEditInstructions: true });
      mocks.profiles = [profile('data')];
      mocks.env.list.mockResolvedValue(listed([], [item('REGION')]));
      mocks.env.setShared.mockResolvedValue(listed([], [item('REGION')]));
      mocks.env.deleteShared.mockResolvedValue(listed([], []));
      await renderHub();
      openEnv();

      expect(screen.getByText('env.sharedHint')).toBeTruthy();
      expect(screen.getAllByText('env.add')).toHaveLength(2);
      fireEvent.click(screen.getByText('env.replace'));
      fireEvent.change(screen.getByLabelText('env.value'), { target: { value: 'eu-west-1' } });
      await act(async () => {
        fireEvent.click(screen.getByText('env.save'));
      });
      expect(mocks.env.setShared).toHaveBeenCalledWith(
        'user:u1',
        'data',
        'REGION',
        'eu-west-1',
        true,
      );

      await act(async () => {
        fireEvent.click(screen.getByText('confirm:env.delete'));
      });
      expect(mocks.env.deleteShared).toHaveBeenCalledWith('user:u1', 'data', 'REGION');
      expect(screen.getAllByText('env.empty')).toHaveLength(2);
    });

    it('shows a non-sensitive value and prefills replace', async () => {
      mocks.profiles = [profile('data')];
      mocks.env.list.mockResolvedValue(
        listed([{ ...item('BASE_URL'), value: 'https://example.test/v1' }], []),
      );
      mocks.env.setMine.mockResolvedValue(
        listed([{ ...item('BASE_URL'), value: 'https://example.test/v2' }], []),
      );
      await renderHub();
      openEnv();

      expect(screen.getByText('https://example.test/v1')).toBeTruthy();
      fireEvent.click(screen.getByText('env.replace'));
      const value = screen.getByLabelText('env.value') as HTMLInputElement;
      expect(value.type).toBe('text');
      expect(value.value).toBe('https://example.test/v1');
      fireEvent.change(value, { target: { value: 'https://example.test/v2' } });
      await act(async () => {
        fireEvent.click(screen.getByText('env.save'));
      });
      expect(mocks.env.setMine).toHaveBeenCalledWith(
        'user:u1',
        'data',
        'BASE_URL',
        'https://example.test/v2',
        false,
      );
    });

    it('says when the server cannot store variables', async () => {
      mocks.profiles = [profile('data')];
      mocks.env.list.mockResolvedValue({ available: false, profiles: {} });
      await renderHub();

      expect(screen.getByText('env.unavailable')).toBeTruthy();
      openEnv();
      expect((screen.getByText('env.add') as HTMLButtonElement).disabled).toBe(true);
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
      expect(mocks.listHubJobs).toHaveBeenCalledWith('user:u1', 1);
      expect(screen.queryByText('jobs.title')).toBeNull();
    });

    it('lists jobs with their profile and cancels a running one', async () => {
      mocks.profiles = [profile('data')];
      const longCommand = `python ${'a'.repeat(180)}.py`;
      const succeeded = [
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
      ];
      mocks.listHubJobs.mockResolvedValue({
        finished: { items: succeeded, page: 1, pageSize: 20, total: succeeded.length },
        running: [running],
      });
      mocks.cancelJob.mockImplementation(async () => {
        mocks.listHubJobs.mockResolvedValue({
          finished: {
            items: [{ ...running, status: 'cancelled' }, ...succeeded],
            page: 1,
            pageSize: 20,
            total: succeeded.length + 1,
          },
          running: [],
        });
      });
      await act(async () => {
        render(<SandboxHub />);
      });

      expect(screen.getByText('jobs.title')).toBeTruthy();
      expect(screen.getByText('jobs.running')).toBeTruthy();
      expect(screen.getByText('jobs.finished')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'jobs.refresh' })).toBeTruthy();
      expect(screen.getByText('python train.py')).toBeTruthy();
      expect(screen.getByText('jobs.status.running')).toBeTruthy();
      expect(screen.getAllByText('jobs.status.succeeded')).toHaveLength(2);
      expect(screen.getByText('make')).toBeTruthy();
      // Each job row names its sandbox first.
      expect(screen.getAllByText(/^data name · jobs\.startedAt/)).toHaveLength(3);
      expect(screen.getByText(longCommand)).toBeTruthy();
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

    it('purges finished jobs', async () => {
      mocks.profiles = [profile('data')];
      const succeeded = {
        command: 'make',
        exitCode: 0,
        finishedAt: '2026-11-02T07:30:00.000Z',
        id: 'sjob_0',
        profileId: 'data',
        startedAt: '2026-11-02T07:00:00.000Z',
        status: 'succeeded' as const,
      };
      const failed = {
        command: 'make check',
        exitCode: 1,
        finishedAt: '2026-11-02T07:40:00.000Z',
        id: 'sjob_fail',
        profileId: 'data',
        startedAt: '2026-11-02T07:35:00.000Z',
        status: 'failed' as const,
      };
      mocks.listHubJobs.mockResolvedValue({
        finished: { items: [succeeded, failed], page: 1, pageSize: 20, total: 2 },
        running: [],
      });
      mocks.purgeFinishedJobs.mockImplementation(async () => {
        mocks.listHubJobs.mockResolvedValue({
          finished: { items: [], page: 1, pageSize: 20, total: 0 },
          running: [],
        });
        return { deleted: 2 };
      });
      await act(async () => {
        render(<SandboxHub />);
      });

      expect(screen.getByText('jobs.finished')).toBeTruthy();
      expect(screen.getByText('make')).toBeTruthy();
      expect(screen.getByText('jobs.status.failed')).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByText('confirm:jobs.purge'));
      });
      expect(mocks.purgeFinishedJobs).toHaveBeenCalledWith('user:u1');
      expect(screen.queryByText('make')).toBeNull();
      expect(screen.queryByText('jobs.title')).toBeNull();
    });

    it('says when cancelling fails', async () => {
      mocks.profiles = [profile('data')];
      mocks.listHubJobs.mockResolvedValue({
        finished: { items: [], page: 1, pageSize: 20, total: 0 },
        running: [running],
      });
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

    it('opens the general instruction from the hub header, not a profile edit form', async () => {
      mocks.profiles = [
        profile('general', { instruction: 'general contract', name: 'Sandbox' }),
        profile('data', { name: 'Claude Code' }),
      ];
      mocks.admin.settings.mockResolvedValue(
        hubSettings([
          settingsItem('general', { name: 'Sandbox' }),
          settingsItem('data', { name: 'Claude Code' }),
        ]),
      );
      await renderAsAdmin();

      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*Sandbox/ }));
      expect(screen.queryByText('profile.instruction.edit')).toBeNull();

      fireEvent.click(screen.getByText('admin.form.generalInstruction'));
      expect(
        screen
          .getAllByRole('dialog')
          .some((dialog) => dialog.textContent?.includes('general contract')),
      ).toBe(true);
      fireEvent.click(screen.getByText('profile.instruction.cancel'));

      fireEvent.click(screen.getAllByRole('button', { name: 'admin.settings' })[1]);
      const editor = screen
        .getAllByRole('dialog')
        .find((dialog) => dialog.textContent?.includes('admin.form.instructionBase'));
      expect(editor?.textContent).not.toContain('admin.form.generalInstruction');
    });

    it('keeps the Sandbox instruction on the card when settings fail to load', async () => {
      mocks.profiles = [profile('general', { name: 'Sandbox' })];
      mocks.admin.settings.mockRejectedValue(new Error('down'));
      await renderAsAdmin();

      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*Sandbox/ }));
      expect(screen.getByText('profile.instruction.edit')).toBeTruthy();
    });

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
      mocks.serverStatus.mockResolvedValue({ remote: 'ok', spare: 'misconfigured' });
      await renderAsAdmin();

      expect(mocks.admin.settings).toHaveBeenCalledWith('user:u1');
      // Admins also see a server no sandbox uses.
      expect(screen.getByText('Spare')).toBeTruthy();
      expect(screen.getByText('health.misconfigured')).toBeTruthy();
      expect(screen.getByText('admin.addProfile')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'admin.more' })).toHaveLength(2);
      expect(screen.getByText('admin.image.ready')).toBeTruthy();
      expect(screen.getByText('admin.image.unknown').parentElement?.textContent).toBe(
        'admin.image.unknown',
      );
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
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

      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
      await act(async () => {
        fireEvent.click(screen.getByText('admin.prepare'));
      });
      expect(mocks.admin.prepare).toHaveBeenCalledWith('user:u1', 'data');
      expect(mocks.load).toHaveBeenCalledWith('user:u1');
      expect(screen.queryByRole('dialog')).toBeNull();

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
      fireEvent.click(screen.getByRole('button', { name: /profile\.details.*data name/ }));
      await act(async () => {
        fireEvent.click(screen.getByText('admin.prepare'));
      });
      expect(screen.getByText('Server "remote" is missing its API key.')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
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
      expect(field('admin.form.idle').getAttribute('inputmode')).toBe('decimal');
      expect(field('admin.form.name').getAttribute('inputmode')).toBeNull();

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
      expect(screen.getByLabelText('admin.form.idle').getAttribute('data-status')).toBe('error');
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

    it('does not apply an avatar generate that finishes after another profile is opened', async () => {
      let finish: (emoji: string) => void = () => undefined;
      mocks.fetchPreset.mockImplementation((options: { onFinish: (emoji: string) => void }) => {
        finish = options.onFinish;
      });
      mocks.profiles = [profile('alpha'), profile('beta')];
      mocks.admin.settings.mockResolvedValue(
        hubSettings([
          settingsItem('alpha', { avatar: '🅰️' }),
          settingsItem('beta', { avatar: '🅱️' }),
        ]),
      );
      await renderAsAdmin();

      fireEvent.click(screen.getAllByRole('button', { name: 'admin.settings' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'autoGenerate' }));
      fireEvent.click(screen.getByText('modal:close'));
      fireEvent.click(screen.getAllByRole('button', { name: 'admin.settings' })[1]);
      await act(async () => {
        finish('🧪');
      });

      expect((screen.getByLabelText('admin.form.avatar') as HTMLInputElement).value).toBe('🅱️');
    });

    it('shows an oversized avatar on the field and clears it when a valid one is chosen', async () => {
      mocks.profiles = [profile('data')];
      await renderAsAdmin();
      fireEvent.click(screen.getByRole('button', { name: 'admin.settings' }));

      fireEvent.change(screen.getByLabelText('admin.form.avatar'), {
        target: { value: 'x'.repeat(64 * 1024 + 1) },
      });
      expect(screen.getByText('admin.form.avatarTooLarge')).toBeTruthy();
      expect(screen.getByText('admin.form.avatarTooLarge').parentElement).toBe(
        screen.getByLabelText('admin.form.avatar').parentElement?.parentElement,
      );

      fireEvent.change(screen.getByLabelText('admin.form.avatar'), { target: { value: '🧪' } });
      expect(screen.queryByText('admin.form.avatarTooLarge')).toBeNull();
      expect((screen.getByLabelText('admin.form.avatar') as HTMLInputElement).value).toBe('🧪');
    });
  });
});
