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

const safeBasename = (filename: string) => {
  const name = filename.replaceAll('\\', '/').split('/').pop() ?? '';
  if (!name || name === '.' || name === '..') return undefined;
  return name;
};

export const createSandboxEnvelopeToken = () => randomBytes(16).toString('hex');

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
    'import os, sys, json, base64, traceback, hashlib, shutil',
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
    'def _data_dir():',
    `    path = os.path.join("/tmp", "${CI_WORKDIR_PREFIX}" + _TOKEN)`,
    '    os.makedirs(path, mode=0o700)',
    '    probe = os.path.join(path, ".chathub_ci_write")',
    '    with open(probe, "wb") as fh:',
    '        fh.write(b"ok")',
    '    os.remove(probe)',
    '    return path',
    'try:',
    '    DATA_DIR = _data_dir()',
    'except Exception:',
    '    sys.stderr.write("Sandbox could not create an isolated working directory.\\n")',
    '    _emit(False, [])',
    '    raise SystemExit(0)',
    'os.chdir(DATA_DIR)',
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
    'def _patch_mpl():',
    '    try:',
    '        import matplotlib',
    '        matplotlib.use("Agg")',
    '        import matplotlib.pyplot as plt',
    '        def show(*args, **kwargs):',
    '            plt.savefig(os.path.join(DATA_DIR, "plot_%s.png" % _PLOT_N["n"]), format="png")',
    '            plt.close()',
    '            _PLOT_N["n"] += 1',
    '        plt.show = show',
    '    except Exception:',
    '        pass',
    'def _flush_mpl():',
    '    try:',
    '        import matplotlib.pyplot as plt',
    '        for num in list(plt.get_fignums()):',
    '            fig = plt.figure(num)',
    '            fig.savefig(os.path.join(DATA_DIR, "plot_%s.png" % _PLOT_N["n"]), format="png")',
    '            _PLOT_N["n"] += 1',
    '            plt.close(fig)',
    '    except Exception:',
    '        pass',
    '_patch_mpl()',
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
    'try:',
    '    for entry in os.listdir(DATA_DIR):',
    '        if entry in (".", "..") or entry.startswith("."):',
    '            continue',
    '        path = os.path.join(DATA_DIR, entry)',
    '        if not os.path.isfile(path):',
    '            continue',
    '        try:',
    '            size = os.path.getsize(path)',
    '            if size > _MAX_FILE:',
    '                continue',
    '            with open(path, "rb") as fh:',
    '                raw = fh.read()',
    '            if entry in _INPUT_HASHES and hashlib.sha256(raw).digest() == _INPUT_HASHES[entry]:',
    '                continue',
    '            _files.append({"b64": base64.b64encode(raw).decode("ascii"), "name": entry})',
    '        except Exception:',
    '            continue',
    'finally:',
    '    try:',
    '        os.chdir("/tmp")',
    '    except Exception:',
    '        pass',
    '    shutil.rmtree(DATA_DIR, ignore_errors=True)',
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
