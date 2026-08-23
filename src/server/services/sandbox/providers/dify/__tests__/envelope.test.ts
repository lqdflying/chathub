import { describe, expect, it } from 'vitest';

import {
  CI_FILES_SENTINEL_PREFIX,
  CI_WORKDIR_PREFIX,
  parseSandboxEnvelope,
  wrapSandboxPreload,
  wrapSandboxPython,
} from '../envelope';

describe('Dify sandbox envelope', () => {
  it('embeds user code and input files as base64, not raw source', () => {
    const wrapped = wrapSandboxPython({
      code: 'print("secret-source")',
      files: [{ contentBase64: Buffer.from('hello').toString('base64'), filename: '../etc/passwd' }],
      maxFileBytes: 1024,
      token: 'abc123',
    });

    expect(wrapped).toContain('MPLBACKEND');
    expect(wrapped).toContain('os.environ["MPLBACKEND"] = "Agg"');
    expect(wrapped).toContain('MPLCONFIGDIR');
    expect(wrapped).toContain('MPL_IGNORE_SYSTEM_FONTS');
    expect(wrapped).toContain('OMP_NUM_THREADS');
    expect(wrapped).toContain('OPENBLAS_NUM_THREADS');
    expect(wrapped).toContain('FONTCONFIG_FILE');
    expect(wrapped).toContain('.fonts.conf');
    expect(wrapped).toContain('XDG_CACHE_HOME');
    expect(wrapped).toContain('subprocess.Popen = _SandboxPopen');
    expect(wrapped).toContain('posix_spawn');
    expect(wrapped).toContain('_posixsubprocess');
    expect(wrapped).toContain('sandbox-exec');
    expect(wrapped).toContain(`/tmp`);
    expect(wrapped).toContain(CI_WORKDIR_PREFIX);
    expect(wrapped).not.toContain('os.makedirs(');
    expect(wrapped).not.toContain('os.chdir(');
    expect(wrapped).not.toContain('os.remove(');
    expect(wrapped).not.toContain('shutil');
    expect(wrapped).toContain('os.chdir =');
    expect(wrapped).not.toContain('import matplotlib');
    expect(wrapped).not.toContain('_patch_mpl()');
    expect(wrapped).not.toContain('/mnt/data');
    expect(wrapped).toContain('ENABLE_PRELOAD=true');
    expect(wrapped).not.toContain('print("secret-source")');
    expect(wrapped).not.toContain('../etc/passwd');
    expect(wrapped).toContain(Buffer.from('print("secret-source")', 'utf8').toString('base64'));
    expect(wrapped).toContain(
      Buffer.from(
        JSON.stringify([{ b64: Buffer.from('hello').toString('base64'), name: 'passwd' }]),
        'utf8',
      ).toString('base64'),
    );
  });

  it('preload creates the 0700 workdir as root before seccomp', () => {
    const preload = wrapSandboxPreload('abc123');
    expect(preload).toContain('os.makedirs(_path, mode=0o700, exist_ok=True)');
    expect(preload).toContain('os.chown(_path, _st.st_uid, _st.st_gid)');
    expect(preload).toContain('"abc123"');
    expect(preload).toContain(CI_WORKDIR_PREFIX);
    expect(preload).toContain('os.stat(__file__)');
    expect(preload).not.toContain('print');
    expect(() => wrapSandboxPreload('not hex')).toThrow(/Invalid sandbox envelope token/);
  });

  it('parses stdout before the sentinel and decodes output files', () => {
    const token = 'deadbeef';
    const payload = {
      files: [{ b64: Buffer.from('plot-bytes').toString('base64'), name: '/tmp/chathub-ci-x/plot_1.png' }],
      success: true,
    };
    const stdout = `hello world\n${CI_FILES_SENTINEL_PREFIX}${token}>>>\n${JSON.stringify(payload)}`;

    const parsed = parseSandboxEnvelope({
      maxFileBytes: 1024,
      maxFileCount: 8,
      stdout,
      token,
    });

    expect(parsed.wrapperPresent).toBe(true);
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toBe('hello world');
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].filename).toBe('plot_1.png');
    expect(Buffer.from(parsed.files[0].content).toString()).toBe('plot-bytes');
  });

  it('drops oversized files and treats missing sentinels as incomplete', () => {
    const token = 'token';
    const huge = Buffer.alloc(16, 1).toString('base64');
    const stdout = `${CI_FILES_SENTINEL_PREFIX}${token}>>>\n${JSON.stringify({
      files: [{ b64: huge, name: 'too-big.bin' }],
      success: true,
    })}`;

    expect(
      parseSandboxEnvelope({ maxFileBytes: 8, maxFileCount: 4, stdout, token }).files,
    ).toEqual([]);
    expect(
      parseSandboxEnvelope({
        maxFileBytes: 1024,
        maxFileCount: 4,
        stdout: 'no wrapper',
        token,
      }),
    ).toMatchObject({ success: true, wrapperPresent: false, stdout: 'no wrapper' });
  });
});
