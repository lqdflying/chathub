/** @vitest-environment node */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildRunnerScript, parseOutputManifest } from '../python';

// Just enough of pyplot for the hook: figures are numbered paths.
const FAKE_PYPLOT = [
  '_figs = {}',
  '_next = [1]',
  'class _Fig:',
  '    def __init__(self, num):',
  '        self.num = num',
  '    def savefig(self, path, format=None):',
  '        open(path, "wb").write(b"png-%d" % self.num)',
  'def figure(num=None):',
  '    if num is None:',
  '        num = _next[0]',
  '        _next[0] += 1',
  '    return _figs.setdefault(num, _Fig(num))',
  'def get_fignums():',
  '    return sorted(_figs)',
  'def close(fig):',
  '    _figs.pop(fig.num, None)',
  'def show():',
  '    raise RuntimeError("original show must be replaced")',
].join('\n');

let root: string;
let workdir: string;
let pythonPath: string;

const run = (code: string, fontPath?: string) => {
  const control = join(workdir, '.chathub');
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, 'code.py'), code);
  writeFileSync(join(control, 'run.py'), buildRunnerScript(workdir, fontPath));
  const result = spawnSync('python3', [join(control, 'run.py')], {
    cwd: workdir,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: pythonPath },
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  let manifest: ReturnType<typeof parseOutputManifest> | undefined;
  try {
    manifest = parseOutputManifest(readFileSync(join(control, 'manifest.json'), 'utf8'));
  } catch {
    manifest = undefined;
  }
  return {
    manifest,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
};

describe('OpenSandbox runner script', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chathub-opensandbox-'));
    workdir = join(root, 'work');
    pythonPath = join(root, 'site');
    mkdirSync(join(pythonPath, 'matplotlib'), { recursive: true });
    writeFileSync(join(pythonPath, 'matplotlib', '__init__.py'), '');
    writeFileSync(join(pythonPath, 'matplotlib', 'pyplot.py'), FAKE_PYPLOT);
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('runs in the workdir, echoes a trailing expression, and lists top-level outputs', () => {
    const { manifest, status, stdout } = run(
      [
        'import os',
        'print("cwd", os.getcwd())',
        'open("out.txt", "w").write("hello")',
        'open(".hidden", "w").write("x")',
        'os.makedirs("nested", exist_ok=True)',
        'open("nested/deep.txt", "w").write("x")',
        '6 * 7',
      ].join('\n'),
    );

    expect(status).toBe(0);
    expect(stdout).toBe(`cwd ${workdir}\n42\n`);
    expect(manifest).toEqual([
      { name: 'out.txt', sha256: createHash('sha256').update('hello').digest('hex'), size: 5 },
    ]);
  });

  it('does not echo None or a trailing statement', () => {
    expect(run('x = 1\nprint("a")').stdout).toBe('a\n');
    expect(run('print("b")').stdout).toBe('b\n');
  });

  it('turns plt.show() into numbered PNGs and flushes figures never shown', () => {
    const { manifest, stderr } = run(
      ['import matplotlib.pyplot as plt', 'plt.figure()', 'plt.show()', 'plt.figure()', 'plt.figure()'].join(
        '\n',
      ),
    );

    expect(stderr).toBe('');
    expect(manifest?.map((entry) => entry.name)).toEqual(['plot_1.png', 'plot_2.png', 'plot_3.png']);
  });

  it('exits 1 with a user-only traceback and still writes the manifest', () => {
    const { manifest, status, stderr } = run(
      'open("partial.csv", "w").write("a,b")\ndef f():\n    raise ValueError("boom")\nf()',
    );

    expect(status).toBe(1);
    expect(stderr).toContain('File "<code>", line 3, in f');
    expect(stderr).toContain('raise ValueError("boom")');
    expect(stderr).toContain('ValueError: boom');
    expect(stderr).not.toContain('run.py');
    expect(manifest?.map((entry) => entry.name)).toEqual(['partial.csv']);
  });

  it('reports a syntax error with its location', () => {
    const { status, stderr } = run('print("ok")\nif True print(1)');

    expect(status).toBe(1);
    expect(stderr).toContain('line 2');
    expect(stderr).toContain('SyntaxError');
  });

  it('maps SystemExit like a script: 0/None succeed, other codes fail', () => {
    expect(run('import sys\nsys.exit(0)')).toMatchObject({ status: 0, stderr: '' });
    expect(run('raise SystemExit')).toMatchObject({ status: 0, stderr: '' });
    expect(run('import sys\nsys.exit(3)')).toMatchObject({ status: 3, stderr: 'SystemExit: 3\n' });
    expect(run('import sys\nsys.exit("bad input")').status).toBe(1);
  });

  it('does not import matplotlib for print-only code', () => {
    expect(run('import sys\nprint("matplotlib.pyplot" in sys.modules)').stdout).toBe('False\n');
  });

  it('stores absolute writes by basename and reopens that file', () => {
    const stale = join(root, 'stale.pdf');
    const outside = join(root, 'missing-dir', 'report.pdf');
    const probe = join(root, 'keep-read.txt');
    writeFileSync(stale, 'stale-bytes');
    writeFileSync(probe, 'keep-read');
    const { manifest, status, stdout } = run(
      [
        'import io, os, pathlib',
        `open(${JSON.stringify(stale)}, "wb").write(b"%PDF-new")`,
        `print("builtin", open(${JSON.stringify(stale)}, "rb").read())`,
        `print("size", os.path.getsize(${JSON.stringify(stale)}), os.lstat(${JSON.stringify(stale)}).st_size)`,
        `io.open(${JSON.stringify(outside)}, "wb").write(b"%PDF-io")`,
        `print("io", io.open(${JSON.stringify(outside)}, "rb").read())`,
        `pathlib.Path(${JSON.stringify(join(root, 'path.pdf'))}).write_bytes(b"%PDF-path")`,
        `print("path", pathlib.Path(${JSON.stringify(join(root, 'path.pdf'))}).read_bytes())`,
        `fd = os.open(${JSON.stringify(join(root, 'os.pdf'))}, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)`,
        'os.write(fd, b"%PDF-os")',
        'os.close(fd)',
        `fd = os.open(${JSON.stringify(join(root, 'os.pdf'))}, os.O_RDONLY)`,
        'print("os", os.read(fd, 16))',
        'os.close(fd)',
        `print("other", open(${JSON.stringify(probe)}).read())`,
      ].join('\n'),
    );

    expect(status).toBe(0);
    expect(stdout).toContain("builtin b'%PDF-new'");
    expect(stdout).toContain('size 8 8');
    expect(stdout).toContain("io b'%PDF-io'");
    expect(stdout).toContain("path b'%PDF-path'");
    expect(stdout).toContain("os b'%PDF-os'");
    expect(stdout).toContain('other keep-read');
    expect(readFileSync(stale, 'utf8')).toBe('stale-bytes');
    expect(readFileSync(probe, 'utf8')).toBe('keep-read');
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(join(root, 'path.pdf'))).toBe(false);
    expect(existsSync(join(root, 'os.pdf'))).toBe(false);
    expect(manifest?.map((entry) => entry.name).sort()).toEqual([
      'os.pdf',
      'path.pdf',
      'report.pdf',
      'stale.pdf',
    ]);
    expect(readFileSync(join(workdir, 'stale.pdf'), 'utf8')).toBe('%PDF-new');
  });

  it('does not collect /dev/null or matplotlib font-cache names', () => {
    const { manifest, status } = run(
      [
        'open("/dev/null", "w").write("x")',
        'open("/root/.cache/matplotlib/fontlist-v9.json", "w").write("cache")',
        'open("/root/.cache/matplotlib/fontlist-v9.json.matplotlib-lock", "w").write("")',
        'open("kept.txt", "w").write("yes")',
      ].join('\n'),
    );

    expect(status).toBe(0);
    expect(existsSync(join(workdir, 'null'))).toBe(false);
    expect(manifest?.map((entry) => entry.name)).toEqual(['kept.txt']);
  });

  it('links STSong.ttf into the workdir without returning it', () => {
    const font = join(root, 'source-font.ttf');
    writeFileSync(font, 'font-bytes');
    const { manifest, status, stdout } = run('print(open("STSong.ttf", "rb").read())', font);

    expect(status).toBe(0);
    expect(stdout).toBe("b'font-bytes'\n");
    expect(readlinkSync(join(workdir, 'STSong.ttf'))).toBe(font);
    expect(manifest).toEqual([]);
  });
});

describe('parseOutputManifest', () => {
  it('ignores malformed and wrongly typed manifests', () => {
    expect(parseOutputManifest('{not json')).toEqual([]);
    expect(parseOutputManifest('{"name":"a"}')).toEqual([]);
    expect(
      parseOutputManifest('[{"name":"a.txt","sha256":"x","size":1},{"name":2}]'),
    ).toEqual([{ name: 'a.txt', sha256: 'x', size: 1 }]);
  });
});
