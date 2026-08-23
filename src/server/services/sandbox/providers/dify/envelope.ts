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
    'import os, sys, json, base64, traceback, hashlib, builtins',
    'os.environ.setdefault("MPLBACKEND", "Agg")',
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
