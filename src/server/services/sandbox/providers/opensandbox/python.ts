/**
 * Runner ChatHub uploads next to the user code and starts with execd's
 * command API (`python3 <runner>`), one process per run.
 *
 * The guest is an ordinary Linux container or microVM, so none of the Dify
 * jail stubs (subprocess, unlink, chdir, threading.Timer) apply. The runner
 * only pins the working directory, forces the Agg backend, turns
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

export const buildRunnerScript = (workdir: string = OPENSANDBOX_WORKDIR): string => {
  const controlDir = `${workdir}/.chathub`;
  return [
    'import ast, hashlib, importlib.abc, importlib.util, io, json, linecache, os, sys, traceback',
    `WORKDIR = ${JSON.stringify(workdir)}`,
    `CONTROL = ${JSON.stringify(controlDir)}`,
    'os.chdir(WORKDIR)',
    'os.environ["MPLBACKEND"] = "Agg"',
    'for _stream in (sys.stdout, sys.stderr):',
    '    try:',
    '        _stream.reconfigure(encoding="utf-8", errors="replace")',
    '    except Exception:',
    '        pass',
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
    '_out = []',
    'for _name in sorted(os.listdir(WORKDIR)):',
    '    _path = os.path.join(WORKDIR, _name)',
    '    if _name.startswith(".") or os.path.islink(_path) or not os.path.isfile(_path):',
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
