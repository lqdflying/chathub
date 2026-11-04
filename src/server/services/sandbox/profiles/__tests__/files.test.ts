// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatNumberedLines } from '../../tool/format';

interface Row {
  content: string;
  mode: number;
  path: string;
  profileId: string;
  sensitive: boolean;
  size: number;
  updatedAt: Date;
  userId: string | null;
}

type Owner = { shared: true } | { userId: string };

const mocks = vi.hoisted(() => ({
  key: 'Kix2AhTLdBi4V3KgkdtUlHOpTsuOe4BcnYeV9DAdqjo=' as string | undefined,
  readError: undefined as unknown,
  rows: [] as Row[],
}));

vi.mock('@/config/db', () => ({
  getServerDBConfig: () => ({ KEY_VAULTS_SECRET: mocks.key }),
}));

const owns = (row: Row, owner: Owner) =>
  'userId' in owner ? row.userId === owner.userId : row.userId === null;

vi.mock('@/database/models/sandboxProfileFile', () => ({
  SandboxProfileFileModel: class {
    count = async (profileId: string, owner: Owner) =>
      mocks.rows.filter((row) => row.profileId === profileId && owns(row, owner)).length;
    delete = async (profileId: string, path: string, owner: Owner) => {
      const before = mocks.rows.length;
      mocks.rows = mocks.rows.filter(
        (row) => !(row.profileId === profileId && row.path === path && owns(row, owner)),
      );
      return mocks.rows.length < before;
    };
    find = async (profileId: string, path: string, owner: Owner) =>
      mocks.rows.find(
        (row) => row.profileId === profileId && row.path === path && owns(row, owner),
      );
    listForSandbox = async (profileId: string, userId: string) => {
      if (mocks.readError) throw mocks.readError;
      return mocks.rows.filter(
        (row) => row.profileId === profileId && (row.userId === null || row.userId === userId),
      );
    };
    listVisible = async (userId: string) => {
      if (mocks.readError) throw mocks.readError;
      return mocks.rows.filter((row) => row.userId === null || row.userId === userId);
    };
    updateSettings = async (
      profileId: string,
      path: string,
      owner: Owner,
      change: { mode: number; sensitive: boolean },
    ) => {
      const row = await this.find(profileId, path, owner);
      if (!row) return false;
      Object.assign(row, { mode: change.mode, sensitive: change.sensitive });
      return true;
    };
    upsertForUser = async (userId: string, write: Record<string, any>) =>
      this.upsert(userId, write);
    upsertShared = async (write: Record<string, any>) => this.upsert(null, write);
    private upsert = (userId: string | null, write: Record<string, any>) => {
      mocks.rows = mocks.rows.filter(
        (row) =>
          !(row.profileId === write.profileId && row.path === write.path && row.userId === userId),
      );
      mocks.rows.push({
        content: write.encryptedContent,
        mode: write.mode,
        path: write.path,
        profileId: write.profileId,
        sensitive: write.sensitive,
        size: write.size,
        updatedAt: new Date('2026-01-02T03:04:05Z'),
        userId,
      });
    };
  },
}));

const {
  SandboxFileError,
  deleteSandboxFile,
  encryptSandboxFileSnapshot,
  listSandboxFiles,
  readSandboxFileSnapshot,
  resolveSandboxFiles,
  sandboxFilePathMessage,
  sandboxFilesFingerprint,
  setSandboxFile,
} = await import('../files');
const { maskSandboxSecrets } = await import('../env');

const db = {} as never;
const b64 = (text: string) => Buffer.from(text).toString('base64');
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

const CONFIG = '[DEFAULT]\nuser=ocid1.user.oc1..aaaaexample\nfingerprint=aa:bb:cc:dd\n';

const set = (
  path: string,
  content: string | undefined,
  owner: Owner,
  extra: { mode?: string; sensitive?: boolean } = {},
) =>
  setSandboxFile({
    content: content === undefined ? undefined : b64(content),
    db,
    mode: extra.mode ?? '600',
    owner,
    path,
    profileId: 'data',
    sensitive: extra.sensitive,
    updatedBy: 'admin',
  });

describe('sandbox file rules', () => {
  it('accepts absolute paths outside the workspace and system folders', () => {
    for (const path of ['/root/.oci/config', '/etc/pip.conf', '/home/a@b/x+y_z-1.pem']) {
      expect(sandboxFilePathMessage(path)).toBeUndefined();
    }
    for (const path of ['root/.oci', '/', '/a//b', '/a/../b', '/a/./b', '/a/', '/a b', '~/.oci']) {
      expect(sandboxFilePathMessage(path)).toMatch(/absolute path/);
    }
    for (const path of ['/tmp/workspace', '/tmp/workspace/.chathub/x', '/proc/1', '/dev/null']) {
      expect(sandboxFilePathMessage(path)).toMatch(/workspace|system folder/);
    }
    expect(sandboxFilePathMessage('/tmp/workspace2/x')).toBeUndefined();
  });
});

describe('sandbox file storage', () => {
  beforeEach(() => {
    mocks.key = 'Kix2AhTLdBi4V3KgkdtUlHOpTsuOe4BcnYeV9DAdqjo=';
    mocks.readError = undefined;
    mocks.rows = [];
  });

  it('stores ciphertext and lists content only for files that are not sensitive', async () => {
    await set('/root/.oci/config', CONFIG, { shared: true });
    await set(
      '/etc/pip.conf',
      '[global]\nindex-url = https://pypi.example\n',
      { userId: 'u1' },
      {
        mode: '644',
        sensitive: false,
      },
    );

    expect(mocks.rows.map((row) => row.content).join()).not.toContain('ocid1');
    const list = await listSandboxFiles(db, 'u1');
    expect(list.profiles.data.shared).toEqual([
      {
        mode: '600',
        path: '/root/.oci/config',
        sensitive: true,
        size: CONFIG.length,
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
    ]);
    expect(list.profiles.data.mine[0]).toMatchObject({
      content: '[global]\nindex-url = https://pypi.example\n',
      mode: '644',
      sensitive: false,
    });
    expect(JSON.stringify(list)).not.toContain('ocid1');
  });

  it("lays a user's own file over the shared one and builds the mask", async () => {
    await set('/root/.oci/config', CONFIG, { shared: true });
    await set('/root/.oci/config', `${CONFIG}region=eu-frankfurt-1\n`, { userId: 'u1' });
    await set(
      '/etc/pip.conf',
      'index-url = https://pypi.example',
      { shared: true },
      {
        sensitive: false,
      },
    );

    const forU1 = await resolveSandboxFiles(db, 'u1', 'data');
    expect(forU1.items.map((item) => [item.path, item.mode])).toEqual([
      ['/etc/pip.conf', 600],
      ['/root/.oci/config', 600],
    ]);
    expect(text(forU1.items[1].content)).toContain('eu-frankfurt-1');
    expect(forU1.mask).toContain('user=ocid1.user.oc1..aaaaexample');
    expect(forU1.mask).not.toContain('index-url = https://pypi.example');

    const forU2 = await resolveSandboxFiles(db, 'u2', 'data');
    expect(text(forU2.items[1].content)).toBe(CONFIG);
  });

  it('masks a sensitive file in command output', async () => {
    await set('/root/.oci/config', CONFIG, { shared: true });
    const { mask } = await resolveSandboxFiles(db, 'u1', 'data');

    expect(maskSandboxSecrets({ stdout: CONFIG }, {}, mask)).toEqual({ stdout: '[secret:FILE]' });
    expect(maskSandboxSecrets('> fingerprint=aa:bb:cc:dd', {}, mask)).toBe('> [secret:FILE]');
  });

  it('leaves out a file that no longer decrypts, and its shared fallback', async () => {
    await set('/root/.netrc', 'machine shared', { shared: true });
    await set('/root/.netrc', 'machine mine', { userId: 'u1' });
    await set('/root/.npmrc', 'token', { shared: true });
    mocks.rows.find((row) => row.userId === 'u1')!.content = 'aa:bb:cc';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { items } = await resolveSandboxFiles(db, 'u1', 'data');
    expect(items.map((item) => item.path)).toEqual(['/root/.npmrc']);
    expect(JSON.stringify(warn.mock.calls)).toContain('/root/.netrc');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('machine');
    warn.mockRestore();
  });

  it('changes only mode and Sensitive when no content is sent', async () => {
    await set('/root/.oci/config', CONFIG, { userId: 'u1' });
    await set('/root/.oci/config', undefined, { userId: 'u1' }, { mode: '400' });
    const { items } = await resolveSandboxFiles(db, 'u1', 'data');
    expect(items[0]).toMatchObject({ mode: 400, path: '/root/.oci/config' });
    expect(text(items[0].content)).toBe(CONFIG);

    await expect(set('/root/.new', undefined, { userId: 'u1' })).rejects.toThrow(
      'Choose a file or paste its content.',
    );
  });

  it('refuses bad input and enforces the per-owner count', async () => {
    await expect(set('/tmp/workspace/x', 'x', { shared: true })).rejects.toBeInstanceOf(
      SandboxFileError,
    );
    await expect(set('/root/x', 'x', { shared: true }, { mode: '0600' })).rejects.toThrow(
      /octal digits/,
    );
    await expect(set('/root/x', 'x', { shared: true }, { mode: '800' })).rejects.toThrow(
      /octal digits/,
    );
    await expect(set('/root/x', '', { shared: true })).rejects.toThrow('The file is empty.');
    await expect(set('/root/x', 'x'.repeat(64 * 1024 + 1), { shared: true })).rejects.toThrow(
      /at most 64 KB/,
    );
    await expect(
      setSandboxFile({
        content: 'not base64!',
        db,
        mode: '600',
        owner: { shared: true },
        path: '/root/x',
        profileId: 'data',
        updatedBy: 'admin',
      }),
    ).rejects.toThrow('The file content could not be read.');

    for (let index = 0; index < 16; index += 1) {
      await set(`/root/f${index}`, 'x', { userId: 'u1' });
    }
    await expect(set('/root/one-more', 'x', { userId: 'u1' })).rejects.toThrow(/At most 16/);
    await expect(set('/root/f0', 'changed', { userId: 'u1' })).resolves.toBeUndefined();
    await expect(set('/root/one-more', 'x', { shared: true })).resolves.toBeUndefined();
  });

  it('is off without KEY_VAULTS_SECRET', async () => {
    mocks.key = undefined;
    await expect(set('/root/x', 'x', { shared: true })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect((await listSandboxFiles(db, 'u1')).available).toBe(false);
    expect(await resolveSandboxFiles(db, 'u1', 'data')).toEqual({ items: [], mask: [] });
  });

  it('refuses to resolve files when the key is missing and rows exist', async () => {
    await set('/root/x', 'secret-value-here', { shared: true });
    mocks.key = undefined;
    await expect(resolveSandboxFiles(db, 'u1', 'data')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('masks a numbered line cut from a longer sensitive file', async () => {
    const line = Array.from({ length: 1250 }, (_, index) => index.toString(36).padStart(4, '0')).join(
      '',
    );
    await set('/root/secret', line, { shared: true });
    const { mask } = await resolveSandboxFiles(db, 'u1', 'data');
    const shown = formatNumberedLines(line, {}).content;
    const masked = maskSandboxSecrets(shown, {}, mask);

    expect(shown).toContain(line.slice(0, 32));
    expect(shown).toContain('…[line truncated]');
    expect(masked).toContain('[secret:FILE]');
    expect(masked).not.toContain(line.slice(0, 32));
    expect(masked).not.toContain(line.slice(1968, 2000));
  });

  it('round-trips a job file snapshot', async () => {
    const cipher = await encryptSandboxFileSnapshot(['user=ocid1.user.oc1..aaaaexample']);
    expect(await readSandboxFileSnapshot(cipher)).toEqual(['user=ocid1.user.oc1..aaaaexample']);
    expect(await encryptSandboxFileSnapshot([])).toBeNull();
    expect(await readSandboxFileSnapshot(null)).toEqual([]);
    await expect(readSandboxFileSnapshot('not-a-ciphertext')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('deletes by owner and reports a missing one', async () => {
    await set('/root/x', 'x', { userId: 'u1' });
    await deleteSandboxFile({ db, owner: { userId: 'u1' }, path: '/root/x', profileId: 'data' });
    await expect(
      deleteSandboxFile({ db, owner: { userId: 'u1' }, path: '/root/x', profileId: 'data' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads as empty while the table does not exist', async () => {
    mocks.readError = Object.assign(new Error('relation "sandbox_profile_files" does not exist'), {
      code: '42P01',
    });
    expect((await listSandboxFiles(db, 'u1')).profiles).toEqual({});
    expect(await resolveSandboxFiles(db, 'u1', 'data')).toEqual({ items: [], mask: [] });
  });
});

describe('sandboxFilesFingerprint', () => {
  const file = (path: string, content: string, mode = 600) => ({
    content: new Uint8Array(Buffer.from(content)),
    mode,
    path,
  });

  it('changes with path, mode or content and not with order', () => {
    const a = sandboxFilesFingerprint([file('/a', '1'), file('/b', '2')]);
    expect(a).toMatch(/^[\da-f]{16}$/);
    expect(sandboxFilesFingerprint([file('/b', '2'), file('/a', '1')])).toBe(a);
    expect(sandboxFilesFingerprint([file('/a', '1'), file('/b', '3')])).not.toBe(a);
    expect(sandboxFilesFingerprint([file('/a', '1', 644), file('/b', '2')])).not.toBe(a);
    expect(sandboxFilesFingerprint([])).toBeUndefined();
  });
});
