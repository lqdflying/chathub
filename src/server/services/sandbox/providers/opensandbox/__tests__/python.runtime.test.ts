/** @vitest-environment node */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const run = (code: string) => {
  const control = join(workdir, '.chathub');
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, 'code.py'), code);
  writeFileSync(join(control, 'run.py'), buildRunnerScript(workdir));
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
