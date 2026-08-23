import { randomBytes } from 'node:crypto';

export const CI_FILES_SENTINEL_PREFIX = '<<<CHATHUB_CI_FILES_V1:';
export const CI_WORKDIR_PREFIX = 'chathub-ci-';

export interface SandboxInputFile {
  contentBase64: string;
  filename: string;
}

export interface SandboxOutputFile {
  content: Uint8Array;
  filename: string;
}

export interface ParsedSandboxEnvelope {
  files: SandboxOutputFile[];
  stdout: string;
  success: boolean;
  wrapperPresent: boolean;
}

const HEX_TOKEN = /^[0-9a-f]+$/u;

const assertSandboxEnvelopeToken = (token: string) => {
  if (!HEX_TOKEN.test(token)) {
    throw new Error('Invalid sandbox envelope token');
  }
};

const safeBasename = (filename: string) => {
  const name = filename.replaceAll('\\', '/').split('/').pop() ?? '';
  if (!name || name === '.' || name === '..') return undefined;
  return name;
};

export const createSandboxEnvelopeToken = () => randomBytes(16).toString('hex');

/**
 * Dify `preload` runs as root **before** chroot, seccomp, and setuid
 * (prescript.py → DifySeccomp). Guest Python cannot mkdir/chdir/unlink:
 * mkdir is ActErrno; chdir/unlink are ActKillProcess.
 *
 * Dify 0.2.10+ **discards** the HTTP `preload` field unless the sidecar has
 * `ENABLE_PRELOAD=true` (default is false). Without that env, this script
 * never runs and the guest probe-write fail-closes.
 * @see https://github.com/langgenius/dify-sandbox/blob/0.2.15/internal/core/runner/python/prescript.py
 * @see https://github.com/langgenius/dify-sandbox/blob/0.2.15/internal/service/python.go
 * @see https://github.com/langgenius/dify-sandbox/blob/0.2.15/internal/static/python_syscall/syscalls_amd64.go
 */
export const wrapSandboxPreload = (token: string): string => {
  assertSandboxEnvelopeToken(token);
  return [
    'import os',
    `_TOKEN = ${JSON.stringify(token)}`,
    'os.umask(0o077)',
    'os.makedirs("tmp", mode=0o755, exist_ok=True)',
    `_path = os.path.join("tmp", "${CI_WORKDIR_PREFIX}" + _TOKEN)`,
    'os.makedirs(_path, mode=0o700, exist_ok=True)',
    '_st = os.stat(__file__)',
    'os.chown(_path, _st.st_uid, _st.st_gid)',
    'os.chmod(_path, 0o700)',
  ].join('\n');
};

export const wrapSandboxPython = ({
  code,
  files,
  maxFileBytes,
  token,
}: {
  code: string;
  files: SandboxInputFile[];
  maxFileBytes: number;
  token: string;
}): string => {
  assertSandboxEnvelopeToken(token);
  const inputs = files
    .map((file) => {
      const filename = safeBasename(file.filename);
      if (!filename) return undefined;
      return { b64: file.contentBase64, name: filename };
    })
    .filter(Boolean);

  const inputsB64 = Buffer.from(JSON.stringify(inputs), 'utf8').toString('base64');
  const userB64 = Buffer.from(code, 'utf8').toString('base64');

  return [
    'import os, sys, json, base64, traceback, hashlib, builtins, subprocess, threading, pathlib',
    // Force Agg. setdefault loses if the sidecar already set Tk/Qt; pyplot then
    // probes GUI backends (https://matplotlib.org/stable/users/explain/figure/backends.html).
    'os.environ["MPLBACKEND"] = "Agg"',
    `_TOKEN = ${JSON.stringify(token)}`,
    `_SENTINEL = "${CI_FILES_SENTINEL_PREFIX}" + _TOKEN + ">>>"`,
    `_MAX_FILE = ${Math.max(1, Math.floor(maxFileBytes))}`,
    `_INPUTS = json.loads(base64.b64decode(${JSON.stringify(inputsB64)}).decode("utf-8"))`,
    `_USER = base64.b64decode(${JSON.stringify(userB64)}).decode("utf-8")`,
    'def _emit(success, files):',
    '    sys.stdout.write("\\n" + _SENTINEL + "\\n")',
    '    sys.stdout.write(json.dumps({"files": files, "success": success}))',
    '    sys.stdout.flush()',
    'def _basename(path):',
    '    name = os.fspath(path).replace("\\\\", "/").split("/")[-1]',
    '    if not name or name in (".", ".."):',
    '        return None',
    '    return name',
    'def _resolve(path):',
    '    if isinstance(path, int):',
    '        return path',
    '    s = os.fspath(path)',
    '    if os.path.isabs(s):',
    '        return s',
    '    name = _basename(s)',
    '    return DATA_DIR if not name else os.path.join(DATA_DIR, name)',
    'def _data_dir():',
    `    path = os.path.join("/tmp", "${CI_WORKDIR_PREFIX}" + _TOKEN)`,
    '    probe = os.path.join(path, ".chathub_ci_write")',
    '    with open(probe, "wb") as fh:',
    '        fh.write(b"ok")',
    '    return path',
    'try:',
    '    DATA_DIR = _data_dir()',
    'except Exception:',
    '    sys.stderr.write("Sandbox could not create an isolated working directory. Set ENABLE_PRELOAD=true on the Dify sidecar.\\n")',
    '    _emit(False, [])',
    '    raise SystemExit(0)',
    'os.environ["TMPDIR"] = DATA_DIR',
    // Matplotlib: MPLCONFIGDIR first, else $HOME/.config, else tempfile+mkdir
    // (https://matplotlib.org/stable/api/matplotlib_configuration_api.html).
    // Guest mkdir is ActErrno; HOME is unset in the jail. Pin config/cache to
    // the existing session dir. MPL_IGNORE_SYSTEM_FONTS skips Python fc-list
    // (https://github.com/matplotlib/matplotlib/blob/v3.11.1/lib/matplotlib/font_manager.py).
    // Dify 0.2.15 can allow clone3+pipe2 while killing execve, so a real
    // subprocess (pyplot fc-list, matplotlib#28488) hangs until ChatHub's 60s
    // AbortSignal. Canary.21 env-only and canary.22 Popen-only still hung on
    // `import pyplot` in prod (C posix_spawn / OpenBLAS clone3 / libfontconfig).
    // Pin BLAS to 1 thread (https://numpy.org/doc/stable/reference/global_state.html)
    // and point fontconfig at an empty config (fonts-conf FONTCONFIG_FILE).
    'os.environ["HOME"] = DATA_DIR',
    'os.environ["MPLCONFIGDIR"] = DATA_DIR',
    'os.environ["XDG_CONFIG_HOME"] = DATA_DIR',
    'os.environ["XDG_CACHE_HOME"] = DATA_DIR',
    'os.environ["MPL_IGNORE_SYSTEM_FONTS"] = "1"',
    'os.environ["OMP_NUM_THREADS"] = "1"',
    'os.environ["OPENBLAS_NUM_THREADS"] = "1"',
    'os.environ["MKL_NUM_THREADS"] = "1"',
    'os.environ["NUMEXPR_NUM_THREADS"] = "1"',
    '_fc = os.path.join(DATA_DIR, ".fonts.conf")',
    'open(_fc, "w").write("<?xml version=\\"1.0\\"?><fontconfig><reset-dirs/></fontconfig>\\n")',
    'os.environ["FONTCONFIG_FILE"] = _fc',
    'os.environ["FONTCONFIG_PATH"] = DATA_DIR',
    'def _no_spawn(*a, **k):',
    "    raise FileNotFoundError(2, 'No such file or directory', 'sandbox-exec')",
    'class _SandboxPopen:',
    '    def __init__(self, *args, **kwargs):',
    '        _no_spawn()',
    'subprocess.Popen = _SandboxPopen',
    'os.system = lambda *a, **k: 127',
    'for _n in ("fork", "forkpty", "posix_spawn", "posix_spawnp"):',
    '    if hasattr(os, _n):',
    '        setattr(os, _n, _no_spawn)',
    '_ps = sys.modules.get("_posixsubprocess")',
    'if _ps is None:',
    '    try:',
    '        _ps = __import__("_posixsubprocess")',
    '    except Exception:',
    '        _ps = None',
    'if _ps is not None and hasattr(_ps, "fork_exec"):',
    '    _ps.fork_exec = _no_spawn',
    // matplotlib 3.11 FontManager.__init__ starts threading.Timer(5, warning).
    // Without clone3, Thread.start() blocks until ChatHub's 60s abort. With
    // clone3, FontManager finishes and cbook._lock_path calls Path.unlink on
    // the cache lock; Dify 0.2.15 ActKillProcess on unlink
    // (https://github.com/matplotlib/matplotlib/blob/v3.11.1/lib/matplotlib/font_manager.py
    // https://github.com/matplotlib/matplotlib/blob/v3.11.1/lib/matplotlib/cbook.py).
    'class _NoopTimer:',
    '    def __init__(self, *a, **k):',
    '        pass',
    '    def start(self, *a, **k):',
    '        pass',
    '    def cancel(self, *a, **k):',
    '        pass',
    '    def join(self, *a, **k):',
    '        pass',
    'threading.Timer = _NoopTimer',
    'os.unlink = lambda *a, **k: None',
    'os.remove = lambda *a, **k: None',
    'pathlib.Path.unlink = lambda *a, **k: None',
    'os.getcwd = lambda: DATA_DIR',
    'os.chdir = lambda *a, **k: None',
    '_real_open = builtins.open',
    'def _open(file, *args, **kwargs):',
    '    if not isinstance(file, int):',
    '        try:',
    '            file = _resolve(file)',
    '        except TypeError:',
    '            pass',
    '    return _real_open(file, *args, **kwargs)',
    'builtins.open = _open',
    '_real_os_open = os.open',
    'def _os_open(path, flags, mode=0o777, *args, **kwargs):',
    '    return _real_os_open(_resolve(path), flags, mode, *args, **kwargs)',
    'os.open = _os_open',
    '_real_listdir = os.listdir',
    'def _listdir(path="."):',
    '    if isinstance(path, int):',
    '        return _real_listdir(path)',
    '    s = os.fspath(path)',
    '    if s in (".", "") or os.path.normpath(s) == os.path.normpath(DATA_DIR):',
    '        return _real_listdir(DATA_DIR)',
    '    return _real_listdir(_resolve(path))',
    'os.listdir = _listdir',
    '_INPUT_NAMES = set()',
    '_INPUT_HASHES = {}',
    'for item in _INPUTS:',
    '    name = os.path.basename(str(item.get("name") or "").replace("\\\\", "/"))',
    '    if not name or name in (".", "..") or name in _INPUT_NAMES:',
    '        continue',
    '    raw = base64.b64decode(item.get("b64") or "")',
    '    if len(raw) > _MAX_FILE:',
    '        continue',
    '    with open(os.path.join(DATA_DIR, name), "wb") as fh:',
    '        fh.write(raw)',
    '    _INPUT_NAMES.add(name)',
    '    _INPUT_HASHES[name] = hashlib.sha256(raw).digest()',
    '_PLOT_N = {"n": 1}',
    // Dify seccomp ActKillProcess is not a Python Exception. Importing matplotlib
    // (or pandas) on every run kills print-only scripts once the sidecar has
    // copied those wheels into the chroot. Patch plt.show only after the user
    // imports pyplot. MPLBACKEND=Agg is already set above; do not import here.
    // @see https://github.com/langgenius/dify-sandbox/blob/0.2.15/FAQ.md
    // @see https://github.com/langgenius/dify/issues/30625
    'def _patch_pyplot():',
    '    plt = sys.modules.get("matplotlib.pyplot")',
    '    if plt is None or getattr(plt, "_chathub_show", False):',
    '        return plt',
    '    def show(*args, **kwargs):',
    '        plt.savefig(os.path.join(DATA_DIR, "plot_%s.png" % _PLOT_N["n"]), format="png")',
    '        plt.close()',
    '        _PLOT_N["n"] += 1',
    '    plt.show = show',
    '    plt._chathub_show = True',
    '    return plt',
    '_real_import = builtins.__import__',
    'def _import(name, globals=None, locals=None, fromlist=(), level=0):',
    '    mod = _real_import(name, globals, locals, fromlist, level)',
    '    if isinstance(name, str) and (name == "matplotlib" or name.startswith("matplotlib.")):',
    '        _patch_pyplot()',
    '    return mod',
    'builtins.__import__ = _import',
    'def _flush_mpl():',
    '    plt = _patch_pyplot()',
    '    if plt is None:',
    '        return',
    '    try:',
    '        for num in list(plt.get_fignums()):',
    '            fig = plt.figure(num)',
    '            fig.savefig(os.path.join(DATA_DIR, "plot_%s.png" % _PLOT_N["n"]), format="png")',
    '            _PLOT_N["n"] += 1',
    '            plt.close(fig)',
    '    except Exception:',
    '        pass',
    '_success = True',
    'try:',
    '    _globals = {"__name__": "__main__"}',
    '    exec(compile(_USER, "<code>", "exec"), _globals)',
    'except SystemExit as exc:',
    '    _code = getattr(exc, "code", None)',
    '    if _code is None or _code == 0:',
    '        pass',
    '    else:',
    '        _success = False',
    '        sys.stderr.write("SystemExit: %s\\n" % (_code,))',
    'except Exception:',
    '    _success = False',
    '    sys.stderr.write(traceback.format_exc())',
    '_flush_mpl()',
    '_files = []',
    'for entry in os.listdir(DATA_DIR):',
    '    if entry in (".", "..") or entry.startswith("."):',
    '        continue',
    '    if entry.endswith(".matplotlib-lock") or entry.startswith("fontlist-v"):',
    '        continue',
    '    path = os.path.join(DATA_DIR, entry)',
    '    if not os.path.isfile(path):',
    '        continue',
    '    try:',
    '        size = os.path.getsize(path)',
    '        if size > _MAX_FILE:',
    '            continue',
    '        with open(path, "rb") as fh:',
    '            raw = fh.read()',
    '        if entry in _INPUT_HASHES and hashlib.sha256(raw).digest() == _INPUT_HASHES[entry]:',
    '            continue',
    '        _files.append({"b64": base64.b64encode(raw).decode("ascii"), "name": entry})',
    '    except Exception:',
    '        continue',
    '_emit(_success, _files)',
  ].join('\n');
};

export const parseSandboxEnvelope = ({
  maxFileBytes,
  maxFileCount,
  stdout,
  token,
}: {
  maxFileBytes: number;
  maxFileCount: number;
  stdout: string;
  token: string;
}): ParsedSandboxEnvelope => {
  const sentinel = `${CI_FILES_SENTINEL_PREFIX}${token}>>>`;
  const index = stdout.lastIndexOf(sentinel);
  if (index < 0) {
    return { files: [], stdout, success: true, wrapperPresent: false };
  }

  const userStdout = stdout.slice(0, index).replace(/[\r\n]+$/u, '');
  const jsonText = stdout.slice(index + sentinel.length).trim();
  let parsed: { files?: Array<{ b64?: string; name?: string }>; success?: boolean } = {};
  try {
    parsed = JSON.parse(jsonText) as typeof parsed;
  } catch {
    return { files: [], stdout: userStdout, success: false, wrapperPresent: true };
  }

  const files: SandboxOutputFile[] = [];
  for (const item of parsed.files ?? []) {
    if (files.length >= maxFileCount) break;
    const filename = typeof item?.name === 'string' ? safeBasename(item.name) : undefined;
    if (!filename || typeof item?.b64 !== 'string') continue;
    try {
      const content = Buffer.from(item.b64, 'base64');
      if (content.byteLength === 0 || content.byteLength > maxFileBytes) continue;
      files.push({ content: new Uint8Array(content), filename });
    } catch {
      continue;
    }
  }

  return {
    files,
    stdout: userStdout,
    success: parsed.success !== false,
    wrapperPresent: true,
  };
};
