import { randomBytes } from 'node:crypto';

export const CI_FILES_SENTINEL_PREFIX = '<<<CHATHUB_CI_FILES_V1:';

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
    'import os, sys, json, base64, traceback',
    'os.environ.setdefault("MPLBACKEND", "Agg")',
    `_TOKEN = ${JSON.stringify(token)}`,
    `_SENTINEL = "${CI_FILES_SENTINEL_PREFIX}" + _TOKEN + ">>>"`,
    `_MAX_FILE = ${Math.max(1, Math.floor(maxFileBytes))}`,
    `_INPUTS = json.loads(base64.b64decode(${JSON.stringify(inputsB64)}).decode("utf-8"))`,
    `_USER = base64.b64decode(${JSON.stringify(userB64)}).decode("utf-8")`,
    'def _data_dir():',
    '    for candidate in ("/mnt/data", "/tmp/mnt/data", os.path.join(os.getcwd(), "mnt_data")):',
    '        try:',
    '            os.makedirs(candidate, exist_ok=True)',
    '            probe = os.path.join(candidate, ".chathub_ci_write")',
    '            with open(probe, "wb") as fh:',
    '                fh.write(b"ok")',
    '            os.remove(probe)',
    '            return candidate',
    '        except Exception:',
    '            continue',
    '    return os.getcwd()',
    'DATA_DIR = _data_dir()',
    'os.chdir(DATA_DIR)',
    '_INPUT_NAMES = set()',
    'for item in _INPUTS:',
    '    name = os.path.basename(str(item.get("name") or "").replace("\\\\", "/"))',
    '    if not name or name in (".", ".."):',
    '        continue',
    '    raw = base64.b64decode(item.get("b64") or "")',
    '    if len(raw) > _MAX_FILE:',
    '        continue',
    '    with open(os.path.join(DATA_DIR, name), "wb") as fh:',
    '        fh.write(raw)',
    '    _INPUT_NAMES.add(name)',
    'def _patch_mpl():',
    '    try:',
    '        import matplotlib',
    '        matplotlib.use("Agg")',
    '        import matplotlib.pyplot as plt',
    '        idx = {"n": 1}',
    '        def show(*args, **kwargs):',
    '            plt.savefig(os.path.join(DATA_DIR, "plot_%s.png" % idx["n"]), format="png")',
    '            plt.clf()',
    '            idx["n"] += 1',
    '        plt.show = show',
    '    except Exception:',
    '        pass',
    'def _flush_mpl():',
    '    try:',
    '        import matplotlib.pyplot as plt',
    '        for i, num in enumerate(list(plt.get_fignums()), 1):',
    '            fig = plt.figure(num)',
    '            fig.savefig(os.path.join(DATA_DIR, "plot_%s.png" % i), format="png")',
    '        plt.close("all")',
    '    except Exception:',
    '        pass',
    '_patch_mpl()',
    '_success = True',
    'try:',
    '    _globals = {"__name__": "__main__"}',
    '    exec(compile(_USER, "<code>", "exec"), _globals)',
    'except SystemExit:',
    '    pass',
    'except Exception:',
    '    _success = False',
    '    sys.stderr.write(traceback.format_exc())',
    '_flush_mpl()',
    '_files = []',
    'for entry in os.listdir(DATA_DIR):',
    '    if entry in _INPUT_NAMES or entry in (".", "..") or entry.startswith("."):',
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
    '        _files.append({"b64": base64.b64encode(raw).decode("ascii"), "name": entry})',
    '    except Exception:',
    '        continue',
    'sys.stdout.write("\\n" + _SENTINEL + "\\n")',
    'sys.stdout.write(json.dumps({"files": _files, "success": _success}))',
    'sys.stdout.flush()',
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
