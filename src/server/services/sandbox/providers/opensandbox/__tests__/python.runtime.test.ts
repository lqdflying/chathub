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

const libraryPython = [
  process.env.OPENSANDBOX_RUNNER_PYTHON,
  '/tmp/opensandbox-pr18-review-venv/bin/python',
]
  .filter((bin): bin is string => !!bin && existsSync(bin))
  .find((bin) => spawnSync(bin, ['-c', 'import openpyxl, matplotlib']).status === 0);

let root: string;
let workdir: string;
let pythonPath: string;

const run = (
  code: string,
  fontPath?: string,
  python?: { bin?: string; fakePyplot?: boolean },
) => {
  const control = join(workdir, '.chathub');
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, 'code.py'), code);
  writeFileSync(join(control, 'run.py'), buildRunnerScript(workdir, fontPath));
  const fakePyplot = python?.fakePyplot !== false;
  const result = spawnSync(python?.bin ?? 'python3', [join(control, 'run.py')], {
    cwd: workdir,
    encoding: 'utf8',
    env: fakePyplot ? { ...process.env, PYTHONPATH: pythonPath } : process.env,
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
      {
        changed: true,
        name: 'out.txt',
        sha256: createHash('sha256').update('hello').digest('hex'),
        size: 5,
      },
    ]);
  });

  it('marks files a later run in the same workdir did not touch as unchanged', () => {
    run(['open("a.txt", "w").write("a")', 'open("b.txt", "w").write("b")'].join('\n'));

    const { manifest, status } = run(
      ['open("b.txt", "a").write("b")', 'open("c.txt", "w").write("c")'].join('\n'),
    );

    expect(status).toBe(0);
    expect(manifest?.map(({ changed, name }) => ({ changed, name }))).toEqual([
      { changed: false, name: 'a.txt' },
      { changed: true, name: 'b.txt' },
      { changed: true, name: 'c.txt' },
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

  it('numbers plots after the ones an earlier run left in the workdir', () => {
    run(['import matplotlib.pyplot as plt', 'plt.figure()', 'plt.show()'].join('\n'));

    const { manifest, stderr } = run(
      ['import matplotlib.pyplot as plt', 'plt.figure()', 'plt.show()'].join('\n'),
    );

    expect(stderr).toBe('');
    expect(manifest?.map(({ changed, name }) => ({ changed, name }))).toEqual([
      { changed: false, name: 'plot_1.png' },
      { changed: true, name: 'plot_2.png' },
    ]);
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
    expect(readFileSync(stale, 'utf8')).toBe('%PDF-new');
    expect(readFileSync(probe, 'utf8')).toBe('keep-read');
    expect(readFileSync(outside)).toEqual(Buffer.from('%PDF-io'));
    expect(readFileSync(join(root, 'path.pdf'))).toEqual(Buffer.from('%PDF-path'));
    expect(readFileSync(join(root, 'os.pdf'))).toEqual(Buffer.from('%PDF-os'));
    expect(manifest?.map((entry) => entry.name).sort()).toEqual([
      'os.pdf',
      'path.pdf',
      'report.pdf',
      'stale.pdf',
    ]);
    expect(readFileSync(join(workdir, 'stale.pdf'), 'utf8')).toBe('%PDF-new');
  });

  it('keeps the newest write when basenames collide', () => {
    mkdirSync(workdir, { recursive: true });
    writeFileSync(join(workdir, 'notes.txt'), 'orig');
    const outside = join(root, 'outside');
    const replayA = join(root, 'a', 'replay.txt');
    const replayB = join(root, 'b', 'replay.txt');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const { manifest, status, stdout } = run(
      [
        `open(${JSON.stringify(join(outside, 'report.txt'))}, "w").write("draft")`,
        'open("report.txt", "w").write("final")',
        'print("report", open("report.txt").read())',
        'open("other.txt", "w").write("draft")',
        `open(${JSON.stringify(join(outside, 'other.txt'))}, "w").write("final")`,
        `print("other", open(${JSON.stringify(join(outside, 'other.txt'))}).read())`,
        'print("other-rel", open("other.txt").read())',
        `open(${JSON.stringify(replayA)}, "w").write("first")`,
        `open(${JSON.stringify(replayB)}, "w").write("second")`,
        `open(${JSON.stringify(replayA)}, "w").write("final")`,
        `print("replay", open(${JSON.stringify(replayA)}).read())`,
        `open(${JSON.stringify(join(outside, 'notes.txt'))}, "w").write("updated")`,
      ].join('\n'),
    );
    const entry = (name: string) => manifest?.find((item) => item.name === name);

    expect(status).toBe(0);
    expect(stdout).toContain('report final');
    expect(stdout).toContain('other final');
    expect(stdout).toContain('other-rel draft');
    expect(stdout).toContain('replay final');
    expect(readFileSync(join(workdir, 'report.txt'), 'utf8')).toBe('final');
    expect(entry('report.txt')).toMatchObject({ sha256: hash('final'), size: 5 });
    expect(readFileSync(join(workdir, 'other.txt'), 'utf8')).toBe('final');
    expect(entry('other.txt')).toMatchObject({ sha256: hash('final'), size: 5 });
    expect(readFileSync(join(workdir, 'replay.txt'), 'utf8')).toBe('final');
    expect(entry('replay.txt')).toMatchObject({ sha256: hash('final'), size: 5 });
    expect(readFileSync(join(workdir, 'notes.txt'), 'utf8')).toBe('updated');
    expect(entry('notes.txt')).toMatchObject({ sha256: hash('updated'), size: 7 });
  });

  it('does not attribute a nested write after chdir to the top-level file', () => {
    const outside = join(root, 'outside', 'report.txt');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const nested = run(
      [
        'open("report.txt", "w").write("draft")',
        `open(${JSON.stringify(outside)}, "w").write("final")`,
        'os_makedirs = __import__("os")',
        'os_makedirs.makedirs("sub", exist_ok=True)',
        'os_makedirs.chdir("sub")',
        'open("report.txt", "w").write("scratch")',
      ].join('\n'),
    );

    expect(nested.status).toBe(0);
    expect(readFileSync(join(workdir, 'report.txt'), 'utf8')).toBe('final');
    expect(readFileSync(join(workdir, 'sub', 'report.txt'), 'utf8')).toBe('scratch');
    expect(nested.manifest?.find((item) => item.name === 'report.txt')).toMatchObject({
      sha256: hash('final'),
      size: 5,
    });
    expect(nested.manifest?.some((item) => item.name.includes('sub'))).toBe(false);

    const back = run(
      [
        `open(${JSON.stringify(outside)}, "w").write("draft")`,
        'os = __import__("os")',
        'os.makedirs("sub", exist_ok=True)',
        'os.chdir("sub")',
        'open("../report.txt", "w").write("final")',
        'os.chdir("..")',
        'print(open("report.txt").read())',
      ].join('\n'),
    );

    expect(back.status).toBe(0);
    expect(back.stdout).toContain('final');
    expect(readFileSync(join(workdir, 'report.txt'), 'utf8')).toBe('final');
  });

  it('ignores a failed open and a read, and honors a write through an earlier handle', () => {
    const outside = join(root, 'outside', 'report.txt');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const failed = run(
      [
        'open("report.txt", "w").write("draft")',
        `open(${JSON.stringify(outside)}, "w").write("final")`,
        'try:',
        '    open("report.txt", "x")',
        'except FileExistsError:',
        '    pass',
      ].join('\n'),
    );

    expect(failed.status).toBe(0);
    expect(readFileSync(join(workdir, 'report.txt'), 'utf8')).toBe('final');
    expect(failed.manifest?.find((item) => item.name === 'report.txt')).toMatchObject({
      sha256: hash('final'),
      size: 5,
    });

    const readOnly = run(
      [
        'open("report.txt", "w").write("draft")',
        `open(${JSON.stringify(outside)}, "w").write("final")`,
        'with open("report.txt", "r+") as handle:',
        '    handle.read()',
      ].join('\n'),
    );

    expect(readOnly.status).toBe(0);
    expect(readFileSync(join(workdir, 'report.txt'), 'utf8')).toBe('final');

    const handle = run(
      [
        `absolute = open(${JSON.stringify(outside)}, "w")`,
        'with open("report.txt", "w") as local:',
        '    local.write("draft")',
        'absolute.write("final")',
        'absolute.close()',
      ].join('\n'),
    );

    expect(handle.status).toBe(0);
    expect(readFileSync(join(workdir, 'report.txt'), 'utf8')).toBe('final');
    expect(handle.manifest?.find((item) => item.name === 'report.txt')).toMatchObject({
      sha256: hash('final'),
      size: 5,
    });
  });

  it('iterates r+ and w+ files like a normal file', () => {
    const seed = [
      'with open("report.txt", "w") as seed:',
      '    seed.write("header\\nrow\\n")',
    ];
    const nextUpdate = run(
      [
        ...seed,
        'with open("report.txt", "r+") as handle:',
        '    print("same", iter(handle) is handle)',
        '    print(next(handle).strip())',
        '    print(next(handle).strip())',
        '    try:',
        '        next(handle)',
        '    except StopIteration:',
        '        print("eof")',
      ].join('\n'),
    );
    const written = run(
      [
        'with open("report.txt", "w+") as handle:',
        '    handle.write("header\\nrow\\n")',
        '    handle.seek(0)',
        '    print("same", iter(handle) is handle)',
        '    print(next(handle).strip())',
      ].join('\n'),
    );
    const saved = run(
      [...seed, 'lines = iter(open("report.txt", "r+"))', 'print(next(lines).strip())'].join('\n'),
    );
    const looped = run(
      [...seed, 'for line in open("report.txt", "r+"):', '    print(line.strip())'].join('\n'),
    );

    expect(nextUpdate.status).toBe(0);
    expect(nextUpdate.stderr).toBe('');
    expect(nextUpdate.stdout).toBe('same True\nheader\nrow\neof\n');
    expect(written.status).toBe(0);
    expect(written.stderr).toBe('');
    expect(written.stdout).toBe('same True\nheader\n');
    expect(saved.status).toBe(0);
    expect(saved.stderr).toBe('');
    expect(saved.stdout).toBe('header\n');
    expect(looped.status).toBe(0);
    expect(looped.stderr).toBe('');
    expect(looped.stdout).toBe('header\nrow\n');
  });

  it('does not collect /dev/null or matplotlib font-cache names', () => {
    const cache = join(root, 'cache', 'fontlist-v9.json');
    const { manifest, status } = run(
      [
        'open("/dev/null", "w").write("x")',
        `open(${JSON.stringify(cache)}, "w").write("cache")`,
        `open(${JSON.stringify(`${cache}.matplotlib-lock`)}, "w").write("")`,
        'open("kept.txt", "w").write("yes")',
      ].join('\n'),
    );

    expect(status).toBe(0);
    expect(existsSync(join(workdir, 'null'))).toBe(false);
    expect(existsSync(join(workdir, 'fontlist-v9.json'))).toBe(false);
    expect(manifest?.map((entry) => entry.name)).toEqual(['kept.txt']);
  });

  it('deletes an absolute path and lets a child process read it', () => {
    const gone = join(root, 'gone.txt');
    const kept = join(root, 'via-cat.txt');
    const removed = run(
      ['import os', `p = ${JSON.stringify(gone)}`, 'open(p, "w").write("hello")', 'os.unlink(p)', 'print("exists", os.path.exists(p))'].join(
        '\n',
      ),
    );
    const child = run(
      [
        'import subprocess',
        `p = ${JSON.stringify(kept)}`,
        'open(p, "w").write("hello")',
        'done = subprocess.run(["cat", p], capture_output=True, text=True)',
        'print(done.returncode)',
        'print(done.stdout)',
      ].join('\n'),
    );

    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain('exists False');
    expect(existsSync(gone)).toBe(false);
    expect(removed.manifest ?? []).toEqual([]);
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('0\nhello');
    expect(readFileSync(kept, 'utf8')).toBe('hello');
    expect(child.manifest?.map((entry) => entry.name)).toEqual(['via-cat.txt']);
  });

  it('does not return tempfile probes', () => {
    const scratch = join(root, 'scratch');
    mkdirSync(scratch);
    const { manifest, status, stdout } = run(
      [
        'import tempfile',
        'print(tempfile.gettempdir())',
        `with tempfile.NamedTemporaryFile(dir=${JSON.stringify(scratch)}) as fh:`,
        '    fh.write(b"hello")',
      ].join('\n'),
    );

    expect(status).toBe(0);
    expect(stdout.split('\n')[0]).not.toBe(workdir);
    expect(manifest ?? []).toEqual([]);
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

  const library = libraryPython ? it : it.skip;

  library('returns only the workbook from a real openpyxl save', () => {
    const { manifest, status, stdout } = run(
      [
        'from openpyxl import Workbook, load_workbook',
        'book = Workbook()',
        'book.active["A1"] = "hello"',
        'book.save("out.xlsx")',
        'print(load_workbook("out.xlsx").active["A1"].value)',
      ].join('\n'),
      undefined,
      { bin: libraryPython, fakePyplot: false },
    );

    expect(status).toBe(0);
    expect(stdout).toContain('hello');
    expect(manifest?.map((entry) => entry.name)).toEqual(['out.xlsx']);
  });

  library('returns only the plot from real matplotlib', () => {
    const { manifest, status, stderr } = run(
      ['import matplotlib.pyplot as plt', 'plt.plot([1, 2], [3, 4])', 'plt.show()'].join('\n'),
      undefined,
      { bin: libraryPython, fakePyplot: false },
    );

    expect(status).toBe(0);
    expect(stderr).not.toContain('Error');
    expect(manifest?.map((entry) => entry.name)).toEqual(['plot_1.png']);
  });
});

describe('parseOutputManifest', () => {
  it('ignores malformed and wrongly typed manifests', () => {
    expect(parseOutputManifest('{not json')).toEqual([]);
    expect(parseOutputManifest('{"name":"a"}')).toEqual([]);
    expect(
      parseOutputManifest('[{"name":"a.txt","sha256":"x","size":1},{"name":2}]'),
    ).toEqual([{ changed: true, name: 'a.txt', sha256: 'x', size: 1 }]);
  });

  it('treats a missing changed flag as changed', () => {
    expect(
      parseOutputManifest(
        '[{"name":"a.txt","sha256":"x","size":1,"changed":false},{"name":"b.txt","sha256":"y","size":2}]',
      ).map(({ changed, name }) => ({ changed, name })),
    ).toEqual([
      { changed: false, name: 'a.txt' },
      { changed: true, name: 'b.txt' },
    ]);
  });
});
