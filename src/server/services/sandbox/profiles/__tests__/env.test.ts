// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  hint: string | null;
  name: string;
  profileId: string;
  updatedAt: Date;
  userId: string | null;
  value: string;
}

const mocks = vi.hoisted(() => ({
  key: 'Kix2AhTLdBi4V3KgkdtUlHOpTsuOe4BcnYeV9DAdqjo=' as string | undefined,
  readError: undefined as unknown,
  rows: [] as Row[],
}));

vi.mock('@/config/db', () => ({
  getServerDBConfig: () => ({ KEY_VAULTS_SECRET: mocks.key }),
}));

const ownerMatches = (row: Row, owner: { shared: true } | { userId: string }) =>
  'userId' in owner ? row.userId === owner.userId : row.userId === null;

vi.mock('@/database/models/sandboxProfileEnv', () => ({
  SandboxProfileEnvModel: class {
    count = async (profileId: string, owner: { shared: true } | { userId: string }) =>
      mocks.rows.filter((row) => row.profileId === profileId && ownerMatches(row, owner)).length;
    delete = async (
      profileId: string,
      name: string,
      owner: { shared: true } | { userId: string },
    ) => {
      const before = mocks.rows.length;
      mocks.rows = mocks.rows.filter(
        (row) => !(row.profileId === profileId && row.name === name && ownerMatches(row, owner)),
      );
      return mocks.rows.length < before;
    };
    find = async (profileId: string, name: string, owner: { shared: true } | { userId: string }) =>
      mocks.rows.find(
        (row) => row.profileId === profileId && row.name === name && ownerMatches(row, owner),
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
    upsertForUser = async (userId: string, write: Record<string, string>) =>
      this.upsert(userId, write);
    upsertShared = async (write: Record<string, string>) => this.upsert(null, write);
    private upsert = (userId: string | null, write: Record<string, string>) => {
      mocks.rows = mocks.rows.filter(
        (row) =>
          !(row.profileId === write.profileId && row.name === write.name && row.userId === userId),
      );
      mocks.rows.push({
        hint: write.hint,
        name: write.name,
        profileId: write.profileId,
        updatedAt: new Date('2026-01-02T03:04:05Z'),
        userId,
        value: write.encryptedValue,
      });
    };
  },
}));

const {
  SandboxEnvError,
  deleteSandboxEnv,
  listSandboxEnvs,
  maskSandboxSecrets,
  resolveSandboxEnv,
  sandboxEnvFingerprint,
  sandboxEnvHint,
  sandboxEnvNameProblem,
  setSandboxEnv,
} = await import('../env');

const db = {} as never;

const set = (name: string, value: string, owner: { shared: true } | { userId: string }) =>
  setSandboxEnv({ db, name, owner, profileId: 'data', updatedBy: 'admin', value });

describe('sandbox env rules', () => {
  it('accepts shell-style names and refuses reserved or malformed ones', () => {
    expect(sandboxEnvNameProblem('GITHUB_TOKEN')).toBeUndefined();
    expect(sandboxEnvNameProblem('_PRIVATE')).toBeUndefined();
    for (const name of ['lower', '1ABC', 'A-B', 'A'.repeat(65), '']) {
      expect(sandboxEnvNameProblem(name)).toMatch(/capital letters/);
    }
    for (const name of ['PATH', 'LD_PRELOAD', 'OPENSANDBOX_X', 'EXECD_PORT', 'CHATHUB_KEY']) {
      expect(sandboxEnvNameProblem(name)).toMatch(/reserved/);
    }
  });

  it('hints only the last 4 characters of a long value', () => {
    expect(sandboxEnvHint('short')).toBe('••••');
    expect(sandboxEnvHint('ghp_abcdefgh1234')).toBe('••••1234');
  });
});

describe('sandbox env storage', () => {
  beforeEach(() => {
    mocks.key = 'Kix2AhTLdBi4V3KgkdtUlHOpTsuOe4BcnYeV9DAdqjo=';
    mocks.readError = undefined;
    mocks.rows = [];
  });

  it('stores ciphertext and lists names and hints only', async () => {
    await set('API_TOKEN', 'shared-secret-value', { shared: true });
    await set('API_TOKEN', 'my-own-secret-value', { userId: 'u1' });

    expect(mocks.rows.map((row) => row.value).join()).not.toContain('secret-value');

    const list = await listSandboxEnvs(db, 'u1');
    expect(list).toEqual({
      available: true,
      profiles: {
        data: {
          mine: [{ hint: '••••alue', name: 'API_TOKEN', updatedAt: '2026-01-02T03:04:05.000Z' }],
          shared: [{ hint: '••••alue', name: 'API_TOKEN', updatedAt: '2026-01-02T03:04:05.000Z' }],
        },
      },
    });
    expect(JSON.stringify(list)).not.toContain('secret-value');
    // Another user sees the shared variable only.
    expect((await listSandboxEnvs(db, 'u2')).profiles.data.mine).toEqual([]);
  });

  it("lays a user's own value over the shared one", async () => {
    await set('API_TOKEN', 'shared-secret-value', { shared: true });
    await set('REGION', 'eu-west-1', { shared: true });
    await set('API_TOKEN', 'my-own-secret-value', { userId: 'u1' });

    expect(await resolveSandboxEnv(db, 'u1', 'data')).toEqual({
      API_TOKEN: 'my-own-secret-value',
      REGION: 'eu-west-1',
    });
    expect(await resolveSandboxEnv(db, 'u2', 'data')).toEqual({
      API_TOKEN: 'shared-secret-value',
      REGION: 'eu-west-1',
    });
  });

  it('leaves out a value that no longer decrypts', async () => {
    await set('API_TOKEN', 'shared-secret-value', { shared: true });
    await set('REGION', 'eu-west-1', { shared: true });
    mocks.rows[0].value = 'aa:bb:cc';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await resolveSandboxEnv(db, 'u1', 'data')).toEqual({ REGION: 'eu-west-1' });
    expect(JSON.stringify(warn.mock.calls)).toContain('API_TOKEN');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    warn.mockRestore();
  });

  it('refuses bad input and enforces the per-owner count', async () => {
    await expect(set('PATH', 'x', { shared: true })).rejects.toBeInstanceOf(SandboxEnvError);
    await expect(set('TOKEN', '', { shared: true })).rejects.toThrow('Enter a value.');
    await expect(set('TOKEN', 'x'.repeat(8 * 1024 + 1), { shared: true })).rejects.toThrow(
      /at most 8 KB/,
    );

    for (let index = 0; index < 32; index += 1) {
      await set(`VAR_${index}`, 'value', { userId: 'u1' });
    }
    await expect(set('ONE_MORE', 'value', { userId: 'u1' })).rejects.toThrow(/At most 32/);
    // Replacing an existing one is still allowed, and shared has its own count.
    await expect(set('VAR_0', 'changed', { userId: 'u1' })).resolves.toBeUndefined();
    await expect(set('ONE_MORE', 'value', { shared: true })).resolves.toBeUndefined();
  });

  it('is off without KEY_VAULTS_SECRET', async () => {
    mocks.key = undefined;
    await expect(set('TOKEN', 'value', { shared: true })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect((await listSandboxEnvs(db, 'u1')).available).toBe(false);
    expect(await resolveSandboxEnv(db, 'u1', 'data')).toEqual({});
  });

  it('deletes by owner and reports a missing one', async () => {
    await set('API_TOKEN', 'shared-secret-value', { shared: true });
    await set('API_TOKEN', 'my-own-secret-value', { userId: 'u1' });

    await deleteSandboxEnv({ db, name: 'API_TOKEN', owner: { userId: 'u1' }, profileId: 'data' });
    expect(await resolveSandboxEnv(db, 'u1', 'data')).toEqual({
      API_TOKEN: 'shared-secret-value',
    });
    await expect(
      deleteSandboxEnv({ db, name: 'API_TOKEN', owner: { userId: 'u1' }, profileId: 'data' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads as empty while the table does not exist', async () => {
    mocks.readError = Object.assign(new Error('relation "sandbox_profile_envs" does not exist'), {
      code: '42P01',
    });
    expect((await listSandboxEnvs(db, 'u1')).profiles).toEqual({});
    expect(await resolveSandboxEnv(db, 'u1', 'data')).toEqual({});
  });
});

describe('sandboxEnvFingerprint', () => {
  beforeEach(() => {
    mocks.key = 'Kix2AhTLdBi4V3KgkdtUlHOpTsuOe4BcnYeV9DAdqjo=';
  });

  it('changes with any value and does not depend on order', () => {
    const a = sandboxEnvFingerprint({ A: '1', B: '2' });
    expect(a).toMatch(/^[\da-f]{16}$/);
    expect(sandboxEnvFingerprint({ B: '2', A: '1' })).toBe(a);
    expect(sandboxEnvFingerprint({ A: '1', B: '3' })).not.toBe(a);
    expect(sandboxEnvFingerprint({})).toBeUndefined();
  });

  it('depends on the server key', () => {
    const a = sandboxEnvFingerprint({ A: '1' });
    mocks.key = 'b3RoZXIta2V5LW90aGVyLWtleS1vdGhlci1rZXktMDA=';
    expect(sandboxEnvFingerprint({ A: '1' })).not.toBe(a);
  });
});

describe('maskSandboxSecrets', () => {
  it('masks values in every string, longest first', () => {
    const env = { LONG: 'secret-value-123', SHORT: 'secret', TINY: 'abc' };
    const result = maskSandboxSecrets(
      {
        files: [{ content: 'token=secret-value-123\n' }],
        nested: { stderr: 'secret seen', untouched: 42 },
        stdout: 'abc stays',
      },
      env,
    );
    expect(result).toEqual({
      files: [{ content: 'token=[secret:LONG]\n' }],
      nested: { stderr: '[secret:SHORT] seen', untouched: 42 },
      stdout: 'abc stays',
    });
  });

  it('does not mask a mask again', () => {
    const env = { SHORT: 'secret' };
    const once = maskSandboxSecrets('a secret here', env);
    expect(once).toBe('a [secret:SHORT] here');
    expect(maskSandboxSecrets(once, env)).toBe(once);
  });

  it('treats values as literal text', () => {
    expect(maskSandboxSecrets('pw=a.b*c(d)$', { PASSWORD: 'a.b*c(d)$' })).toBe(
      'pw=[secret:PASSWORD]',
    );
    expect(maskSandboxSecrets('aXbYcZd', { PASSWORD: 'a.b.c.d' })).toBe('aXbYcZd');
  });

  it('returns the value itself when nothing can be masked', () => {
    const value = { stdout: 'x' };
    expect(maskSandboxSecrets(value, {})).toBe(value);
    expect(maskSandboxSecrets(value, { TINY: 'abc' })).toBe(value);
  });

  it('leaves non-plain objects alone', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(maskSandboxSecrets({ bytes }, { LONG: 'secret-value' }).bytes).toBe(bytes);
  });
});
