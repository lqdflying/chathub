/**
 * Runner ChatHub uploads next to the user code and starts with execd's
 * command API (`python3 <runner>`), one process per run.
 *
 * The guest is an ordinary Linux container or microVM, so none of the Dify
 * jail stubs (subprocess, unlink, chdir, threading.Timer) apply. The runner
 * pins the working directory, keeps absolute writes on their real paths, and
 * copies a file that is still there at the end into the workdir under its
 * basename. It forces the Agg backend, turns
 * `plt.show()` into PNG files, echoes a trailing expression the way a
 * notebook would, and writes a sha256 manifest of the workdir so ChatHub
 * downloads only new or changed files.
 *
 * Jupyter is deliberately not used: execd opens a new kernel websocket per
 * cell and matches replies by message type only, and its code streams hung
 * intermittently in local tests (server 1.1.0 and 1.1.1-rc.1).
 *
 * The workdir sits under /tmp so it stays writable when an operator enables
 * execd's optional Landlock floor (read+write /tmp).
 * @see https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/architecture/data-plane/execd.md
 */
export const OPENSANDBOX_WORKDIR = '/tmp/chathub-ci';
// The image installs the WenQuanYi collection at this path. ReportLab 5.0.1
// accepts the 'ttcf' header and embeds subfont 0, so the file does not need
// to be a single-face TTF. The runner links it into the workdir as STSong.ttf.
export const OPENSANDBOX_FONT_PATH = '/usr/share/fonts/truetype/STSong.ttf';
// Hidden, so the manifest never lists it as an output.
export const CONTROL_DIR = `${OPENSANDBOX_WORKDIR}/.chathub`;
export const RUNNER_PATH = `${CONTROL_DIR}/run.py`;
export const USER_CODE_PATH = `${CONTROL_DIR}/code.py`;
export const MANIFEST_PATH = `${CONTROL_DIR}/manifest.json`;
// Fixed string: user code reaches the sandbox only as an uploaded file.
export const RUN_COMMAND = `python3 ${RUNNER_PATH}`;

export interface OutputManifestEntry {
  name: string;
  sha256: string;
  size: number;
}

export const buildRunnerScript = (
  workdir: string = OPENSANDBOX_WORKDIR,
  fontPath: string = OPENSANDBOX_FONT_PATH,
): string => {
  const controlDir = `${workdir}/.chathub`;
  return [
    'import ast, builtins, hashlib, importlib.abc, importlib.util, io, json, linecache, os, shutil, sys, traceback',
    `WORKDIR = ${JSON.stringify(workdir)}`,
    `CONTROL = ${JSON.stringify(controlDir)}`,
    `FONT = ${JSON.stringify(fontPath)}`,
    'os.chdir(WORKDIR)',
    'os.environ["MPLBACKEND"] = "Agg"',
    'for _stream in (sys.stdout, sys.stderr):',
    '    try:',
    '        _stream.reconfigure(encoding="utf-8", errors="replace")',
    '    except Exception:',
    '        pass',
    // Record absolute writes and create missing parents, but leave the bytes
    // on that path. unlink, stat, and child processes then see the same file.
    // /dev, /proc, and /sys are untouched. A captured file is copied into the
    // workdir only when that path's last successful content change is newer
    // than the workdir file. The path is resolved from the current directory
    // when the file is opened. A failed open or a read does not count.
    '_CAPTURED = []',
    '_ORDER = {}',
    '_SEQ = {"n": 0}',
    '_FD_PATHS = {}',
    'def _touch(path):',
    '    _SEQ["n"] += 1',
    '    _ORDER[os.path.normpath(os.fspath(path))] = _SEQ["n"]',
    'def _resolve_opened(path):',
    '    s = os.fspath(path)',
    '    if os.path.isabs(s):',
    '        return os.path.normpath(s)',
    '    return os.path.normpath(os.path.abspath(s))',
    'def _truncating(mode):',
    '    text = str(mode)',
    '    return "w" in text or "x" in text',
    'def _basename(path):',
    '    name = os.fspath(path).replace("\\\\", "/").split("/")[-1]',
    '    if not name or name in (".", ".."):',
    '        return None',
    '    return name',
    'def _inside(path):',
    '    norm = os.path.normpath(path)',
    '    root = os.path.normpath(WORKDIR)',
    '    return norm == root or norm.startswith(root + os.sep)',
    'def _special(path):',
    '    norm = os.path.normpath(path)',
    '    return norm in ("/dev", "/proc", "/sys") or norm.startswith(("/dev/", "/proc/", "/sys/"))',
    'def _note_write(path):',
    '    if isinstance(path, int):',
    '        return path',
    '    try:',
    '        s = os.fspath(path)',
    '    except TypeError:',
    '        return path',
    '    if not isinstance(s, str) or not os.path.isabs(s) or _special(s) or _inside(s):',
    '        return path',
    '    norm = os.path.normpath(s)',
    '    parent = os.path.dirname(norm)',
    '    if parent and parent != norm:',
    '        os.makedirs(parent, exist_ok=True)',
    '    if norm not in _CAPTURED:',
    '        _CAPTURED.append(norm)',
    '    return norm',
    'def _is_write_mode(mode):',
    '    return any(flag in str(mode) for flag in ("w", "a", "x", "+"))',
    '_real_open = builtins.open',
    'class _Tracked:',
    '    def __init__(self, fh, real):',
    '        self._fh = fh',
    '        self._real = real',
    '    def write(self, data):',
    '        result = self._fh.write(data)',
    '        if result:',
    '            _touch(self._real)',
    '        return result',
    '    def writelines(self, lines):',
    '        result = self._fh.writelines(lines)',
    '        _touch(self._real)',
    '        return result',
    '    def truncate(self, *args, **kwargs):',
    '        result = self._fh.truncate(*args, **kwargs)',
    '        _touch(self._real)',
    '        return result',
    '    def __enter__(self):',
    '        return self',
    '    def __exit__(self, *args):',
    '        self._fh.close()',
    '        return False',
    '    def __iter__(self):',
    '        return iter(self._fh)',
    '    def __del__(self):',
    '        fh = getattr(self, "_fh", None)',
    '        if fh is not None and not fh.closed:',
    '            try:',
    '                fh.close()',
    '            except Exception:',
    '                pass',
    '    def __getattr__(self, name):',
    '        return getattr(self._fh, name)',
    'def _open(file, mode="r", *args, **kwargs):',
    '    target = file',
    '    tracked = not isinstance(file, int) and _is_write_mode(mode)',
    '    if tracked:',
    '        try:',
    '            target = _note_write(file)',
    '        except TypeError:',
    '            target = file',
    '            tracked = False',
    '    fh = _real_open(target, mode, *args, **kwargs)',
    '    if tracked:',
    '        try:',
    '            real = _resolve_opened(target)',
    '        except TypeError:',
    '            real = None',
    '        if real:',
    '            if _truncating(mode):',
    '                _touch(real)',
    '            return _Tracked(fh, real)',
    '    return fh',
    'builtins.open = _open',
    'io.open = _open',
    '_real_os_open = os.open',
    'def _os_writing(flags):',
    '    if not isinstance(flags, int):',
    '        return False',
    '    accmode = getattr(os, "O_ACCMODE", 3)',
    '    return (flags & accmode) != getattr(os, "O_RDONLY", 0)',
    'def _os_open(path, flags, mode=0o777, *args, **kwargs):',
    '    target = path',
    '    if not isinstance(path, int) and _os_writing(flags):',
    '        try:',
    '            target = _note_write(path)',
    '        except TypeError:',
    '            target = path',
    '    fd = _real_os_open(target, flags, mode, *args, **kwargs)',
    '    if not isinstance(path, int) and _os_writing(flags):',
    '        try:',
    '            real = _resolve_opened(target)',
    '        except TypeError:',
    '            real = None',
    '        if real:',
    '            _FD_PATHS[fd] = real',
    '            if flags & getattr(os, "O_TRUNC", 0):',
    '                _touch(real)',
    '    return fd',
    'os.open = _os_open',
    '_real_os_write = os.write',
    'def _os_write(fd, data):',
    '    written = _real_os_write(fd, data)',
    '    real = _FD_PATHS.get(fd)',
    '    if written and real:',
    '        _touch(real)',
    '    return written',
    'os.write = _os_write',
    '_real_os_close = os.close',
    'def _os_close(fd):',
    '    _FD_PATHS.pop(fd, None)',
    '    return _real_os_close(fd)',
    'os.close = _os_close',
    'def _publish_captured():',
    '    chosen = {}',
    '    for src in _CAPTURED:',
    '        try:',
    '            if os.path.islink(src) or not os.path.isfile(src):',
    '                continue',
    '            name = _basename(src)',
    '            if not name or name.startswith(".") or name.startswith("fontlist-v") or name.endswith(".matplotlib-lock"):',
    '                continue',
    '            seq = _ORDER.get(os.path.normpath(src), 0)',
    '            prev = chosen.get(name)',
    '            if prev is None or seq > prev[0] or (seq == prev[0] and src > prev[1]):',
    '                chosen[name] = (seq, src)',
    '        except Exception:',
    '            pass',
    '    for name, item in chosen.items():',
    '        seq, src = item',
    '        try:',
    '            dest = os.path.join(WORKDIR, name)',
    '            if os.path.normpath(dest) == os.path.normpath(src):',
    '                continue',
    '            if os.path.islink(dest):',
    '                continue',
    '            if os.path.isfile(dest) and _ORDER.get(os.path.normpath(dest), 0) >= seq:',
    '                continue',
    '            shutil.copyfile(src, dest)',
    '        except Exception:',
    '            pass',
    '_dest = os.path.join(WORKDIR, "STSong.ttf")',
    'if FONT and os.path.isfile(FONT) and not os.path.lexists(_dest):',
    '    os.symlink(FONT, _dest)',
    '_PLOTS = {"n": 1}',
    'def _save_figures(plt):',
    '    for num in list(plt.get_fignums()):',
    '        fig = plt.figure(num)',
    '        fig.savefig(os.path.join(WORKDIR, "plot_%s.png" % _PLOTS["n"]), format="png")',
    '        _PLOTS["n"] += 1',
    '        plt.close(fig)',
    'def _patch_pyplot(plt):',
    '    def show(*args, **kwargs):',
    '        _save_figures(plt)',
    '    plt.show = show',
    // Patch pyplot when it is imported, so print-only runs never import it.
    'class _PyplotHook(importlib.abc.MetaPathFinder):',
    '    def find_spec(self, name, path=None, target=None):',
    '        if name != "matplotlib.pyplot":',
    '            return None',
    '        sys.meta_path.remove(self)',
    '        spec = importlib.util.find_spec(name)',
    '        if spec is not None and spec.loader is not None:',
    '            exec_module = spec.loader.exec_module',
    '            def _exec_module(module):',
    '                exec_module(module)',
    '                _patch_pyplot(module)',
    '            spec.loader.exec_module = _exec_module',
    '        return spec',
    'sys.meta_path.insert(0, _PyplotHook())',
    'def _run():',
    '    with io.open(os.path.join(CONTROL, "code.py"), encoding="utf-8") as fh:',
    '        source = fh.read()',
    // Tracebacks show the user's lines instead of bare line numbers.
    '    linecache.cache["<code>"] = (len(source), None, source.splitlines(True), "<code>")',
    '    tree = ast.parse(source, "<code>")',
    '    last = None',
    '    if tree.body and isinstance(tree.body[-1], ast.Expr):',
    '        last = ast.Expression(tree.body.pop().value)',
    '    scope = {"__name__": "__main__", "__builtins__": __builtins__}',
    '    exec(compile(tree, "<code>", "exec"), scope)',
    '    if last is not None:',
    '        value = eval(compile(last, "<code>", "eval"), scope)',
    '        if value is not None:',
    '            print(repr(value))',
    '_status = 0',
    'try:',
    '    _run()',
    'except SystemExit as exc:',
    '    if exc.code not in (None, 0):',
    '        _status = exc.code if isinstance(exc.code, int) else 1',
    '        sys.stderr.write("SystemExit: %s\\n" % (exc.code,))',
    'except BaseException:',
    '    _status = 1',
    '    _type, _value, _tb = sys.exc_info()',
    // Drop runner frames; a SyntaxError keeps none and still prints its location.
    '    while _tb is not None and _tb.tb_frame.f_code.co_filename != "<code>":',
    '        _tb = _tb.tb_next',
    '    traceback.print_exception(_type, _value, _tb)',
    'try:',
    '    _plt = sys.modules.get("matplotlib.pyplot")',
    '    if _plt is not None and hasattr(_plt, "get_fignums"):',
    '        _save_figures(_plt)',
    'except Exception:',
    '    pass',
    '_publish_captured()',
    '_out = []',
    'for _name in sorted(os.listdir(WORKDIR)):',
    '    _path = os.path.join(WORKDIR, _name)',
    '    if _name.startswith(".") or os.path.islink(_path) or not os.path.isfile(_path):',
    '        continue',
    '    if _name.startswith("fontlist-v") or _name.endswith(".matplotlib-lock"):',
    '        continue',
    '    _hash = hashlib.sha256()',
    '    with io.open(_path, "rb") as _fh:',
    '        for _chunk in iter(lambda: _fh.read(1 << 20), b""):',
    '            _hash.update(_chunk)',
    '    _out.append({"name": _name, "sha256": _hash.hexdigest(), "size": os.path.getsize(_path)})',
    'with io.open(os.path.join(CONTROL, "manifest.json"), "w", encoding="utf-8") as _fh:',
    '    json.dump(_out, _fh)',
    'sys.stdout.flush()',
    'sys.stderr.flush()',
    'sys.exit(_status)',
  ].join('\n');
};

export const parseOutputManifest = (text: string): OutputManifestEntry[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { name, sha256, size } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof sha256 !== 'string' || typeof size !== 'number') {
      return [];
    }
    return [{ name, sha256, size }];
  });
};
