import * as Comlink from 'comlink';
import { PyodideAPI, loadPyodide as loadPyodideType } from 'pyodide';
import urlJoin from 'url-join';

import { PythonOptions, PythonOutput, PythonResult } from './types';

declare global {
  // eslint-disable-next-line no-var
  var loadPyodide: typeof loadPyodideType;
}

// PEP 503 name normalization + requirement-name extraction, used to match
// requested packages against the Pyodide lockfile's bundled package names
const normalizePackageName = (name: string) => name.toLowerCase().replaceAll(/[._-]+/g, '-');
const requirementBareName = (req: string) => req.split(/[\s!;<=>@[~]/)[0];

const PATCH_MATPLOTLIB = `
def patch_matplotlib():
  import matplotlib
  import matplotlib.pyplot as plt
  from matplotlib import font_manager

  # patch plt.show
  matplotlib.use('Agg')
  index = 1
  def show():
    nonlocal index
    plt.savefig(f'/mnt/data/plot_{index}.png', format="png")
    plt.clf()
    index += 1
  plt.show = show

  # patch fonts
  font_path = '/usr/share/fonts/truetype/STSong.ttf'
  font_manager.fontManager.addfont(font_path)
  plt.rcParams['font.family'] = 'STSong'

patch_matplotlib()`;

// Pyodide 对象不能在 Worker 之间传递，因此定义为全局变量
let pyodide: PyodideAPI | undefined;

// Bound the result BEFORE it crosses Comlink and gets persisted, so a runaway
// program can't exhaust memory during transfer or bloat the stored message. The
// renderer cap is only defense-in-depth. Both a total-character AND a record-count
// budget are needed: blank prints emit empty strings, so a char-only cap would
// still allow an unbounded array of empty records.
const MAX_TOTAL_OUTPUT_CHARS = 200_000;
const MAX_OUTPUT_RECORDS = 2000;
const MAX_RESULT_CHARS = 100_000;

class PythonWorker {
  pyodideIndexUrl: string;
  pypiIndexUrl: string;
  uploadedFiles: File[];

  constructor(options: PythonOptions) {
    this.pypiIndexUrl = options.pypiIndexUrl || 'PYPI';
    this.pyodideIndexUrl =
      options.pyodideIndexUrl || 'https://cdn.jsdelivr.net/pyodide/v0.28.2/full';
    globalThis.importScripts(urlJoin(this.pyodideIndexUrl, 'pyodide.js'));
    this.uploadedFiles = [];
  }

  get pyodide() {
    if (!pyodide) {
      throw new Error('Python interpreter not initialized');
    }
    return pyodide;
  }

  /**
   * 初始化 Python 解释器
   */
  async init() {
    pyodide = await globalThis.loadPyodide({
      indexURL: this.pyodideIndexUrl,
    });
    pyodide.FS.mkdirTree('/mnt/data');
    pyodide.FS.chdir('/mnt/data');
  }

  /**
   * 上传文件到解释器环境中
   * @param files 文件列表
   */
  async uploadFiles(files: File[]) {
    for (const file of files) {
      const content = new Uint8Array(await file.arrayBuffer());
      // TODO: 此处可以考虑使用 WORKERFS 减少一次拷贝
      // Always write under /mnt/data using the basename only — a crafted
      // absolute or `../`-containing name must not escape the sandbox dir.
      const safeName = file.name.split(/[/\\]/).pop() || file.name;
      this.pyodide.FS.writeFile(`/mnt/data/${safeName}`, content);
      this.uploadedFiles.push(file);
    }
  }

  /**
   * 从解释器环境中下载变动的文件
   * @param files 文件列表
   */
  async downloadFiles() {
    const result: File[] = [];
    for (const entry of this.pyodide.FS.readdir('/mnt/data')) {
      if (entry === '.' || entry === '..') continue;
      const filePath = `/mnt/data/${entry}`;
      // pyodide 的 FS 类型定义有问题，只能采用 any
      const content = (this.pyodide.FS as any).readFile(filePath, { encoding: 'binary' });
      const blob = new Blob([content]);
      const file = new File([blob], filePath);
      if (await this.isNewFile(file)) {
        result.push(file);
      }
    }
    return result;
  }

  /**
   * 安装 Python 包
   * @param packages 包名列表
   */
  async installPackages(packages: string[]) {
    await this.pyodide.loadPackage('micropip');
    const micropip = this.pyodide.pyimport('micropip');
    micropip.set_index_urls([this.pypiIndexUrl, 'PYPI']);
    try {
      await micropip.install(packages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // micropip's "Can't find a pure Python 3 wheel" means a (transitive)
      // native dependency has no WebAssembly build — say so plainly instead of
      // surfacing the raw resolver error
      if (/pure python 3 wheel/i.test(message)) {
        throw new Error(
          `No Pyodide/WebAssembly-compatible build exists for: ${packages.join(', ')}. ` +
            `Use the version bundled with Pyodide (drop the version pin) or remove the package. ` +
            `Original error: ${message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Prepare the interpreter for a run: load Pyodide-bundled packages FIRST
   * (both the code's imports and any requested names that are bundled), then
   * send micropip only the requirements the loaded environment does not
   * already satisfy. Ordering matters: giving micropip an unpinned name like
   * "jsonschema" first lets it resolve PyPI's latest, whose native deps
   * (rpds-py>=0.25) have no wasm wheel — while Pyodide bundles a compatible
   * version all along.
   */
  async prepareEnvironment(code: string, packages: string[]) {
    await this.pyodide.loadPackagesFromImports(code);

    const requested = packages.map((p) => p.trim()).filter((p) => p !== '');
    if (requested.length === 0) return;

    const lockfilePackages: Record<string, unknown> =
      (this.pyodide as { lockfile?: { packages?: Record<string, unknown> } }).lockfile?.packages ??
      {};
    const bundledByNormalized = new Map(
      Object.keys(lockfilePackages).map((name) => [normalizePackageName(name), name]),
    );

    // load the bundled copy for every requested name Pyodide ships — a plain
    // name is fully satisfied by it; a versioned one gets checked against the
    // bundled version below instead of being resolved from PyPI first. Direct
    // references (`pkg @ https://…`) are never satisfied by a bundled copy:
    // the user asked for a specific artifact, so they go straight to micropip.
    const bundledToLoad: string[] = [];
    const remaining: string[] = [];
    for (const req of requested) {
      const isDirectReference = req.includes('://');
      const bundled = isDirectReference
        ? undefined
        : bundledByNormalized.get(normalizePackageName(requirementBareName(req)));
      if (bundled) {
        bundledToLoad.push(bundled);
        if (requirementBareName(req) !== req) remaining.push(req);
      } else {
        remaining.push(req);
      }
    }
    if (bundledToLoad.length > 0) await this.pyodide.loadPackage(bundledToLoad);
    if (remaining.length === 0) return;

    // evaluate requirement satisfaction in Python (bundled `packaging` parses
    // specifiers; micropip vendors its own copy, so load it explicitly)
    await this.pyodide.loadPackage('packaging');
    this.pyodide.globals.set('__chathub_requested_packages', JSON.stringify(remaining));
    const unsatisfiedJson = await this.pyodide.runPythonAsync(`
import json
from importlib.metadata import PackageNotFoundError, version
from packaging.requirements import InvalidRequirement, Requirement

def __chathub_unsatisfied(raw_reqs):
    out = []
    for raw in raw_reqs:
        try:
            req = Requirement(raw)
        except InvalidRequirement:
            out.append(raw)
            continue
        if req.marker is not None and not req.marker.evaluate():
            continue
        if req.url is not None:
            # a direct reference names a specific artifact — an installed
            # name/version match must never silently substitute for it
            out.append(raw)
            continue
        if req.extras:
            out.append(raw)
            continue
        try:
            installed = version(req.name)
        except PackageNotFoundError:
            out.append(raw)
            continue
        if not req.specifier.contains(installed, prereleases=True):
            out.append(raw)
    return out

json.dumps(__chathub_unsatisfied(json.loads(__chathub_requested_packages)))
`);
    const unsatisfied: string[] = JSON.parse(String(unsatisfiedJson));
    if (unsatisfied.length === 0) return;

    await this.installPackages(unsatisfied);
  }

  /**
   * 执行 Python 代码
   * @param code 代码
   */
  async runPython(code: string): Promise<PythonResult> {
    await this.patchFonts();
    // NOTE: loadPackagesFromImports 只会处理 pyodide 官方包
    await this.pyodide.loadPackagesFromImports(code);
    await this.patchPackages();

    // 安装依赖后再捕获标准输出，避免记录安装日志
    const output: PythonOutput[] = [];
    // bound BOTH total characters and record count; charge each record its
    // length + 1 (the batched newline) so blank lines still consume budget
    let totalOutput = 0;
    let outputTruncated = false;
    const pushOutput = (data: string, type: 'stderr' | 'stdout') => {
      if (outputTruncated) return;
      if (output.length >= MAX_OUTPUT_RECORDS || totalOutput >= MAX_TOTAL_OUTPUT_CHARS) {
        output.push({ data: '\n…[output truncated]', type: 'stderr' });
        outputTruncated = true;
        return;
      }
      const remaining = MAX_TOTAL_OUTPUT_CHARS - totalOutput;
      const slice = data.length > remaining ? data.slice(0, remaining) : data;
      output.push({ data: slice, type });
      totalOutput += slice.length + 1;
      if (slice.length < data.length) {
        output.push({ data: '\n…[output truncated]', type: 'stderr' });
        outputTruncated = true;
      }
    };
    this.pyodide.setStdout({ batched: (o: string) => pushOutput(o, 'stdout') });
    this.pyodide.setStderr({ batched: (o: string) => pushOutput(o, 'stderr') });

    // 执行代码
    let result;
    let success = false;
    let execError: string | undefined;
    try {
      result = await this.pyodide.runPythonAsync(code);
      success = true;
    } catch (error) {
      execError = error instanceof Error ? error.message : String(error);
    }

    // Always surface an execution exception, even if ordinary output already hit
    // the cap (pushOutput drops everything once outputTruncated is set). This
    // record is intentionally exempt from the record/char budget so a late
    // failure stays visible — but its own message must still be bounded, or a
    // Python `raise Exception('x' * 10**7)` would cross Comlink unbounded and
    // bloat the persisted message.
    if (execError !== undefined) {
      const boundedError =
        execError.length > MAX_RESULT_CHARS
          ? `${execError.slice(0, MAX_RESULT_CHARS)}\n…[error truncated]`
          : execError;
      output.push({ data: boundedError, type: 'stderr' });
    }

    let resultStr = result?.toString();
    if (resultStr !== undefined && resultStr.length > MAX_RESULT_CHARS) {
      resultStr = `${resultStr.slice(0, MAX_RESULT_CHARS)}\n…[result truncated]`;
    }

    return { output, result: resultStr, success };
  }

  private async patchPackages() {
    const hasMatplotlib = Object.keys(this.pyodide.loadedPackages).includes('matplotlib');
    if (hasMatplotlib) {
      await this.pyodide.runPythonAsync(PATCH_MATPLOTLIB);
    }
  }

  private async patchFonts() {
    this.pyodide.FS.mkdirTree('/usr/share/fonts/truetype');
    const fontFiles = {
      'STSong.ttf':
        'https://cdn.jsdelivr.net/gh/Haixing-Hu/latex-chinese-fonts@latest/chinese/宋体/STSong.ttf',
    };
    for (const [filename, url] of Object.entries(fontFiles)) {
      const buffer = await fetch(url, { cache: 'force-cache' }).then((res) => res.arrayBuffer());
      // NOTE: 此处理论上使用 createLazyFile 更好，但 pyodide 中使用会导致报错
      this.pyodide.FS.writeFile(`/usr/share/fonts/truetype/${filename}`, new Uint8Array(buffer));
    }
  }

  private async isNewFile(file: File) {
    const isSameFile = async (a: File, b: File) => {
      // a 是传入的文件，可能使用了绝对路径或相对路径
      // b 是解释器环境中的文件，使用绝对路径
      if (a.name.startsWith('/')) {
        if (a.name !== b.name) return false;
      } else {
        if (`/mnt/data/${a.name}` !== b.name) return false;
      }

      if (a.size !== b.size) return false;

      const aBuffer = await a.arrayBuffer();
      const bBuffer = await b.arrayBuffer();
      const aArray = new Uint8Array(aBuffer);
      const bArray = new Uint8Array(bBuffer);
      const length = aArray.length;
      for (let i = 0; i < length; i++) {
        if (aArray[i] !== bArray[i]) return false;
      }

      return true;
    };
    const t = await Promise.all(this.uploadedFiles.map((f) => isSameFile(f, file)));
    return t.every((f) => !f);
  }
}

Comlink.expose(PythonWorker);

export { PythonWorker };
export type PythonWorkerType = typeof PythonWorker;
