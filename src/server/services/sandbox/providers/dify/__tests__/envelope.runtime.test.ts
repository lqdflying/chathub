/** @vitest-environment node */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSandboxEnvelope, wrapSandboxPython, type SandboxInputFile } from '../envelope';

const runWrapper = ({
  code,
  env,
  files = [],
  token = 'aa',
}: {
  code: string;
  env?: NodeJS.ProcessEnv;
  files?: SandboxInputFile[];
  token?: string;
}) => {
  const wrapped = wrapSandboxPython({
    code,
    files,
    maxFileBytes: 1024 * 1024,
    token,
  });
  const workdir = join('/tmp', `chathub-ci-${token}`);
  mkdirSync(workdir, { recursive: true, mode: 0o700 });
  try {
    const result = spawnSync('python3', ['-c', wrapped], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 15_000,
    });
    if (result.error) throw result.error;
    return {
      parsed: parseSandboxEnvelope({
        maxFileBytes: 1024 * 1024,
        maxFileCount: 20,
        stdout: result.stdout ?? '',
        token,
      }),
      status: result.status,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  } finally {
    rmSync(workdir, { force: true, recursive: true });
  }
};

const file = (filename: string, content: string): SandboxInputFile => ({
  contentBase64: Buffer.from(content).toString('base64'),
  filename,
});

describe('Dify sandbox envelope runtime', () => {
  it('uses a per-run /tmp directory and does not leak another run’s files', () => {
    const first = runWrapper({
      code: 'open("marker-a.txt", "w").write("alpha")',
      token: 'aa',
    });
    const second = runWrapper({
      code: 'open("marker-b.txt", "w").write("beta")\nimport os\nprint("\\n".join(sorted(os.listdir("."))))',
      token: 'bb',
    });

    expect(first.parsed.success).toBe(true);
    expect(first.parsed.files.map((item) => item.filename)).toEqual(['marker-a.txt']);
    expect(second.parsed.success).toBe(true);
    expect(second.parsed.stdout).not.toContain('marker-a.txt');
    expect(second.parsed.files.map((item) => item.filename)).toEqual(['marker-b.txt']);
  });

  it('returns an in-place edited input and omits an unchanged input', () => {
    const edited = runWrapper({
      code: 'open("input.csv", "w").write("cleaned")',
      files: [file('input.csv', 'raw,rows')],
    });
    expect(edited.parsed.success).toBe(true);
    expect(edited.parsed.files).toHaveLength(1);
    expect(edited.parsed.files[0].filename).toBe('input.csv');
    expect(Buffer.from(edited.parsed.files[0].content).toString()).toBe('cleaned');

    const unchanged = runWrapper({
      code: 'print(open("input.csv").read())',
      files: [file('input.csv', 'raw,rows')],
    });
    expect(unchanged.parsed.success).toBe(true);
    expect(unchanged.parsed.files).toEqual([]);
    expect(unchanged.parsed.stdout).toContain('raw,rows');
  });

  it('keeps the newest duplicate basename when wrapping inputs', () => {
    const result = runWrapper({
      code: 'print(open("same.txt").read())',
      files: [file('same.txt', 'newest'), file('same.txt', 'older')],
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.stdout).toContain('newest');
    expect(result.parsed.stdout).not.toContain('older');
  });

  it('treats sys.exit(0) as success and sys.exit(2) as failure', () => {
    const ok = runWrapper({ code: 'import sys\nsys.exit(0)' });
    expect(ok.parsed.wrapperPresent).toBe(true);
    expect(ok.parsed.success).toBe(true);

    const failed = runWrapper({ code: 'import sys\nsys.exit(2)' });
    expect(failed.parsed.success).toBe(false);
    expect(failed.stderr).toContain('SystemExit: 2');
  });

  it('does not overwrite plt.show() output with a blank flush', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'chathub-fake-mpl-'));
    mkdirSync(join(fakeRoot, 'matplotlib'));
    writeFileSync(join(fakeRoot, 'matplotlib', '__init__.py'), 'def use(*args, **kwargs):\n    pass\n');
    writeFileSync(
      join(fakeRoot, 'matplotlib', 'pyplot.py'),
      [
        '_cleared = False',
        '_nums = [1]',
        'class _Fig:',
        '    def savefig(self, path, format=None):',
        '        open(path, "wb").write(b"blank" if _cleared else b"chart-pixels")',
        'def savefig(path, format=None):',
        '    _Fig().savefig(path, format)',
        'def clf():',
        '    global _cleared',
        '    _cleared = True',
        'def close(*args, **kwargs):',
        '    global _nums',
        '    _nums = []',
        'def get_fignums():',
        '    return list(_nums)',
        'def figure(num=None):',
        '    return _Fig()',
        '',
      ].join('\n'),
    );

    try {
      const result = runWrapper({
        code: 'import matplotlib.pyplot as plt\nplt.show()',
        env: { PYTHONPATH: fakeRoot },
      });
      expect(result.parsed.success).toBe(true);
      expect(result.parsed.files).toHaveLength(1);
      expect(result.parsed.files[0].filename).toBe('plot_1.png');
      expect(Buffer.from(result.parsed.files[0].content).toString()).toBe('chart-pixels');
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });
});
