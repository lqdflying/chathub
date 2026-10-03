/** @vitest-environment node */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('fails subprocess immediately instead of hanging on a blocked execve', () => {
    const result = runWrapper({
      code: [
        'import subprocess, time',
        't = time.time()',
        'try:',
        "    subprocess.check_output(['fc-list', '--help'])",
        "    print('spawned')",
        'except FileNotFoundError as exc:',
        "    print('blocked', int((time.time() - t) * 1000), type(exc).__name__)",
      ].join('\n'),
      token: 'ff',
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.stdout).toMatch(/blocked \d+ FileNotFoundError/);
    expect(result.parsed.stdout).not.toContain('spawned');
    const msec = Number(/blocked (\d+)/.exec(result.parsed.stdout)?.[1]);
    expect(msec).toBeLessThan(2000);
  });

  it('pins matplotlib config to the session dir and skips system fontconfig', () => {
    const result = runWrapper({
      code: [
        'import os',
        'print(os.environ.get("MPLCONFIGDIR"))',
        'print(os.environ.get("MPL_IGNORE_SYSTEM_FONTS"))',
        'print(os.environ.get("HOME") == os.environ.get("TMPDIR"))',
        'print(os.environ.get("OMP_NUM_THREADS"))',
        'print(os.environ.get("MPLBACKEND"))',
        'print(os.path.basename(os.environ.get("FONTCONFIG_FILE") or ""))',
      ].join('\n'),
      token: 'ee',
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.stdout).toContain('/tmp/chathub-ci-ee');
    expect(result.parsed.stdout).toContain('\n1\nTrue\n1\nAgg\n.fonts.conf');
    expect(result.parsed.files.map((item) => item.filename)).not.toContain('.fonts.conf');
  });

  it('fails posix_spawn and fork immediately instead of hanging', () => {
    const result = runWrapper({
      code: [
        'import os, time',
        't = time.time()',
        'try:',
        "    os.posix_spawn('/bin/true', ['/bin/true'], os.environ)",
        "    print('spawned')",
        'except FileNotFoundError:',
        "    print('posix_blocked', int((time.time() - t) * 1000))",
        't = time.time()',
        'try:',
        '    os.fork()',
        "    print('forked')",
        'except FileNotFoundError:',
        "    print('fork_blocked', int((time.time() - t) * 1000))",
      ].join('\n'),
      token: 'fd',
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.stdout).toMatch(/posix_blocked \d+/);
    expect(result.parsed.stdout).toMatch(/fork_blocked \d+/);
    expect(result.parsed.stdout).not.toContain('spawned');
    expect(result.parsed.stdout).not.toContain('forked');
    const posixMs = Number(/posix_blocked (\d+)/.exec(result.parsed.stdout)?.[1]);
    const forkMs = Number(/fork_blocked (\d+)/.exec(result.parsed.stdout)?.[1]);
    expect(posixMs).toBeLessThan(2000);
    expect(forkMs).toBeLessThan(2000);
  });

  it('no-ops threading.Timer.start and unlink so matplotlib font cache cannot hang or SIGSYS', () => {
    const result = runWrapper({
      code: [
        'import os, pathlib, threading, time',
        't = time.time()',
        'th = threading.Timer(30, lambda: None)',
        'th.start()',
        "print('timer_ms', int((time.time() - t) * 1000))",
        'os.unlink("missing-file")',
        'os.remove("missing-file")',
        'pathlib.Path("missing-file").unlink()',
        "print('unlinked')",
      ].join('\n'),
      token: '11',
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.stdout).toMatch(/timer_ms \d+/);
    expect(result.parsed.stdout).toContain('unlinked');
    const msec = Number(/timer_ms (\d+)/.exec(result.parsed.stdout)?.[1]);
    expect(msec).toBeLessThan(2000);
  });

  it('does not import matplotlib for a print-only run', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'chathub-fake-mpl-print-'));
    const marker = join(fakeRoot, 'imported');
    mkdirSync(join(fakeRoot, 'matplotlib'));
    writeFileSync(
      join(fakeRoot, 'matplotlib', '__init__.py'),
      `open(${JSON.stringify(marker)}, "w").write("imported")\n`,
    );
    writeFileSync(join(fakeRoot, 'matplotlib', 'pyplot.py'), 'show = lambda *a, **k: None\n');

    try {
      const result = runWrapper({
        code: 'print("hello")',
        env: { PYTHONPATH: fakeRoot },
        token: 'cc',
      });
      expect(result.parsed.success).toBe(true);
      expect(result.parsed.stdout).toContain('hello');
      expect(result.status).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  it('does not return matplotlib font-cache files as chat outputs', () => {
    const result = runWrapper({
      code: [
        'open("fontlist-v3.11.0.json", "w").write("cache")',
        'open("fontlist-v3.11.0.json.matplotlib-lock", "w").write("")',
        'open("plot_1.png", "wb").write(b"chart-pixels")',
      ].join('\n'),
      token: '22',
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.files.map((item) => item.filename)).toEqual(['plot_1.png']);
  });

  it('collects absolute /tmp writes and relative PDF writes in the session dir', () => {
    const outside = '/tmp/chathub-ci-outside.pdf';
    const osOpen = '/tmp/chathub-ci-osopen.pdf';
    const readProbe = '/tmp/chathub-ci-read-probe.txt';
    writeFileSync(readProbe, 'keep-read');
    try {
      const result = runWrapper({
        code: [
          'import os',
          'open("/tmp/chathub-ci-outside.pdf", "wb").write(b"%PDF-abs")',
          'open("relative.pdf", "wb").write(b"%PDF-rel")',
          'fd = os.open("/tmp/chathub-ci-osopen.pdf", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)',
          'os.write(fd, b"%PDF-os")',
          'os.close(fd)',
          'print(open("/tmp/chathub-ci-read-probe.txt").read())',
        ].join('\n'),
        token: 'a1b2',
      });
      expect(result.parsed.success).toBe(true);
      expect(result.parsed.stdout).toContain('keep-read');
      expect(result.parsed.files.map((item) => item.filename).sort()).toEqual([
        'chathub-ci-osopen.pdf',
        'chathub-ci-outside.pdf',
        'relative.pdf',
      ]);
      expect(existsSync(outside)).toBe(false);
      expect(existsSync(osOpen)).toBe(false);
    } finally {
      rmSync(readProbe, { force: true });
      rmSync(outside, { force: true });
      rmSync(osOpen, { force: true });
    }
  });

  it('reopens an absolute path after the write was redirected', () => {
    const stale = '/tmp/chathub-ci-stale.pdf';
    const fresh = '/tmp/chathub-ci-fresh.pdf';
    const readProbe = '/tmp/chathub-ci-read-probe-2.txt';
    writeFileSync(stale, 'stale-bytes');
    writeFileSync(readProbe, 'keep-read');
    try {
      const result = runWrapper({
        code: [
          'import io, os, pathlib',
          'open("/tmp/chathub-ci-stale.pdf", "wb").write(b"%PDF-new")',
          'print("builtin", open("/tmp/chathub-ci-stale.pdf", "rb").read())',
          'print("exists", os.path.exists("/tmp/chathub-ci-stale.pdf"), os.path.getsize("/tmp/chathub-ci-stale.pdf"))',
          'io.open("/tmp/chathub-ci-fresh.pdf", "wb").write(b"%PDF-io")',
          'print("io", io.open("/tmp/chathub-ci-fresh.pdf", "rb").read())',
          'pathlib.Path("/tmp/chathub-ci-path.pdf").write_bytes(b"%PDF-path")',
          'print("path", pathlib.Path("/tmp/chathub-ci-path.pdf").read_bytes(), pathlib.Path("/tmp/chathub-ci-path.pdf").stat().st_size)',
          'fd = os.open("/tmp/chathub-ci-os.pdf", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)',
          'os.write(fd, b"%PDF-os")',
          'os.close(fd)',
          'fd = os.open("/tmp/chathub-ci-os.pdf", os.O_RDONLY)',
          'print("os", os.read(fd, 16))',
          'os.close(fd)',
          'print("other", open("/tmp/chathub-ci-read-probe-2.txt").read())',
        ].join('\n'),
        token: 'c3d4',
      });
      expect(result.parsed.success).toBe(true);
      expect(result.parsed.stdout).toContain("builtin b'%PDF-new'");
      expect(result.parsed.stdout).toContain('exists True 8');
      expect(result.parsed.stdout).toContain("io b'%PDF-io'");
      expect(result.parsed.stdout).toContain("path b'%PDF-path' 9");
      expect(result.parsed.stdout).toContain("os b'%PDF-os'");
      expect(result.parsed.stdout).toContain('other keep-read');
      expect(result.parsed.files.map((item) => item.filename).sort()).toEqual([
        'chathub-ci-fresh.pdf',
        'chathub-ci-os.pdf',
        'chathub-ci-path.pdf',
        'chathub-ci-stale.pdf',
      ]);
      expect(Buffer.from(result.parsed.files.find((item) => item.filename.endsWith('stale.pdf'))!.content).toString()).toBe('%PDF-new');
    } finally {
      rmSync(stale, { force: true });
      rmSync(fresh, { force: true });
      rmSync('/tmp/chathub-ci-path.pdf', { force: true });
      rmSync('/tmp/chathub-ci-os.pdf', { force: true });
      rmSync(readProbe, { force: true });
    }
  });

  it('routes zipfile.io.open writes into the session dir', () => {
    const result = runWrapper({
      code: [
        'import zipfile',
        'with zipfile.ZipFile("probe.zip", "w") as z:',
        '    z.writestr("a.txt", "hello-zip")',
        'print("zip-ok")',
      ].join('\n'),
      token: 'c0',
    });
    expect(result.parsed.success).toBe(true);
    expect(result.parsed.stdout).toContain('zip-ok');
    expect(result.parsed.files.map((item) => item.filename)).toEqual(['probe.zip']);
    expect(result.parsed.files[0].content.byteLength).toBeGreaterThan(0);
    expect(existsSync(join(process.cwd(), 'probe.zip'))).toBe(false);
  });

  it('rebinds plt.show after pyplot finishes loading past an early matplotlib.* import', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'chathub-fake-mpl-early-'));
    mkdirSync(join(fakeRoot, 'matplotlib', 'backends'), { recursive: true });
    writeFileSync(join(fakeRoot, 'matplotlib', '__init__.py'), 'def use(*args, **kwargs):\n    pass\n');
    writeFileSync(join(fakeRoot, 'matplotlib', 'backends', '__init__.py'), '');
    writeFileSync(
      join(fakeRoot, 'matplotlib', 'pyplot.py'),
      [
        'import matplotlib.backends  # triggers the import hook while this module is partial',
        '_nums = [1]',
        'class _Fig:',
        '    def savefig(self, path, format=None):',
        '        open(path, "wb").write(b"chart-pixels")',
        'def savefig(path, format=None):',
        '    _Fig().savefig(path, format)',
        'def close(*args, **kwargs):',
        '    global _nums',
        '    _nums = []',
        'def get_fignums():',
        '    return list(_nums)',
        'def figure(num=None):',
        '    return _Fig()',
        'def switch_backend(newbackend):',
        '    pass',
        'def show(*args, **kwargs):',
        '    raise AssertionError("original show must not run")',
        '',
      ].join('\n'),
    );

    try {
      const result = runWrapper({
        code: 'import matplotlib.pyplot as plt\nplt.show()\nprint("show-ok", getattr(plt.show, "_chathub", False))',
        env: { PYTHONPATH: fakeRoot },
        token: '33',
      });
      expect(result.parsed.success).toBe(true);
      expect(result.parsed.stdout).toContain('show-ok True');
      expect(result.parsed.files).toHaveLength(1);
      expect(result.parsed.files[0].filename).toBe('plot_1.png');
      expect(Buffer.from(result.parsed.files[0].content).toString()).toBe('chart-pixels');
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
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
