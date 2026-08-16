// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('comlink', () => ({
  expose: vi.fn(),
}));

describe('PythonWorker', () => {
  const mockPyodide = {
    FS: {
      mkdirTree: vi.fn(),
      chdir: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn(),
      readFile: vi.fn(),
    },
    loadPackage: vi.fn(),
    pyimport: vi.fn(),
    loadPackagesFromImports: vi.fn(),
    setStdout: vi.fn(),
    setStderr: vi.fn(),
    runPythonAsync: vi.fn(),
    loadedPackages: {},
    // bundled-package map used by prepareEnvironment (subset of the real lock)
    lockfile: {
      packages: {
        'jsonschema': { version: '4.23.0' },
        'numpy': { version: '2.0.2' },
        'rpds-py': { version: '0.23.1' },
      },
    },
    globals: {
      set: vi.fn(),
    },
  };

  const mockMicropip = {
    set_index_urls: vi.fn(),
    install: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Setup minimal global mocks
    vi.stubGlobal('importScripts', vi.fn());
    vi.stubGlobal('loadPyodide', vi.fn().mockResolvedValue(mockPyodide));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      }),
    );

    mockPyodide.pyimport.mockReturnValue(mockMicropip);
    mockPyodide.loadedPackages = {};
  });

  const importWorker = async () => {
    const { PythonWorker } = await import('../worker');
    return { PythonWorker };
  };

  describe('constructor', () => {
    it('should initialize with default options', () => {
      return importWorker().then(({ PythonWorker }) => {
        const worker = new PythonWorker({});

        expect(worker.pypiIndexUrl).toBe('PYPI');
        expect(worker.pyodideIndexUrl).toBe('https://cdn.jsdelivr.net/pyodide/v0.28.2/full');
        expect(worker.uploadedFiles).toEqual([]);
      });
    });

    it('should initialize with custom options', () => {
      const options = {
        pyodideIndexUrl: 'https://test.cdn.com/pyodide',
        pypiIndexUrl: 'https://test.pypi.org',
      };
      return importWorker().then(({ PythonWorker }) => {
        const worker = new PythonWorker(options);

        expect(worker.pypiIndexUrl).toBe('https://test.pypi.org');
        expect(worker.pyodideIndexUrl).toBe('https://test.cdn.com/pyodide');
      });
    });

    it('should call importScripts with pyodide.js', () => {
      return importWorker().then(({ PythonWorker }) => {
        new PythonWorker({});
        expect(globalThis.importScripts).toHaveBeenCalledWith(
          expect.stringContaining('/pyodide.js'),
        );
      });
    });
  });

  describe('pyodide getter', () => {
    it('should throw error when pyodide is not initialized', () => {
      return importWorker().then(({ PythonWorker }) => {
        const worker = new PythonWorker({});
        expect(() => worker.pyodide).toThrow('Python interpreter not initialized');
      });
    });

    it('should return pyodide when initialized', async () => {
      const { PythonWorker } = await importWorker();
      const worker = new PythonWorker({});
      await worker.init();
      expect(worker.pyodide).toBe(mockPyodide);
    });
  });

  describe('init', () => {
    it('should initialize pyodide and setup filesystem', async () => {
      const { PythonWorker } = await importWorker();
      const worker = new PythonWorker({
        pyodideIndexUrl: 'https://test.cdn.com/pyodide',
      });

      await worker.init();

      expect(globalThis.loadPyodide).toHaveBeenCalledWith({
        indexURL: 'https://test.cdn.com/pyodide',
      });
      expect(mockPyodide.FS.mkdirTree).toHaveBeenCalledWith('/mnt/data');
      expect(mockPyodide.FS.chdir).toHaveBeenCalledWith('/mnt/data');
    });
  });

  describe('file operations', () => {
    let worker: any;

    beforeEach(async () => {
      const { PythonWorker } = await importWorker();
      worker = new PythonWorker({});
      await worker.init();
    });

    it('should upload files correctly', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });

      await worker.uploadFiles([mockFile]);

      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        '/mnt/data/test.txt',
        expect.any(Uint8Array),
      );
      expect(worker.uploadedFiles).toContain(mockFile);
    });

    it('sanitizes an absolute-path filename into /mnt/data (no traversal)', async () => {
      const absFile = new File([Uint8Array.from([1, 2])], '/abs.txt');
      await worker.uploadFiles([absFile]);
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        '/mnt/data/abs.txt',
        expect.any(Uint8Array),
      );
    });

    it('strips parent-dir traversal from filenames', async () => {
      const evilFile = new File([Uint8Array.from([1])], '../../etc/passwd');
      await worker.uploadFiles([evilFile]);
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        '/mnt/data/passwd',
        expect.any(Uint8Array),
      );
    });

    it('should download new files from filesystem', async () => {
      const mockFileContent = new Uint8Array([1, 2, 3, 4]);

      mockPyodide.FS.readdir.mockReturnValue(['.', '..', 'output.txt']);
      (mockPyodide.FS as any).readFile.mockReturnValue(mockFileContent);

      const files = await worker.downloadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('/mnt/data/output.txt');
    });

    it('should skip identical files in download (dedup)', async () => {
      const same = new File([Uint8Array.from([7, 8])], 'same.txt');
      await worker.uploadFiles([same]);

      mockPyodide.FS.readdir.mockReturnValue(['.', '..', 'same.txt']);
      (mockPyodide.FS as any).readFile.mockReturnValue(Uint8Array.from([7, 8]));

      const files = await worker.downloadFiles();
      expect(files).toHaveLength(0);
    });
  });

  describe('runPython', () => {
    let worker: any;

    beforeEach(async () => {
      const { PythonWorker } = await importWorker();
      worker = new PythonWorker({});
      await worker.init();
    });

    it('should execute python code successfully', async () => {
      const code = 'print("Hello, World!")';
      const expectedResult = 'Hello, World!';

      mockPyodide.runPythonAsync.mockResolvedValue(expectedResult);

      const result = await worker.runPython(code);

      expect(result.success).toBe(true);
      expect(result.result).toBe(expectedResult);
      expect(mockPyodide.runPythonAsync).toHaveBeenCalledWith(code);
    });

    it('should call loadPackagesFromImports with code', async () => {
      const code = 'print("x")';
      mockPyodide.runPythonAsync.mockResolvedValue('x');
      await worker.runPython(code);
      expect(mockPyodide.loadPackagesFromImports).toHaveBeenCalledWith(code);
    });

    it('should handle python execution errors', async () => {
      const error = new Error('SyntaxError: invalid syntax');
      mockPyodide.runPythonAsync.mockRejectedValue(error);

      const result = await worker.runPython('invalid code');

      expect(result.success).toBe(false);
      expect(result.output).toContainEqual({
        data: 'SyntaxError: invalid syntax',
        type: 'stderr',
      });
    });

    it('bounds the output record count and the size of a late exception (finding C / R3-2)', async () => {
      const MAX_RESULT_CHARS = 100_000;
      const hugeMessage = 'x'.repeat(500_000);
      mockPyodide.runPythonAsync.mockImplementation(async () => {
        const stdout = mockPyodide.setStdout.mock.calls.at(-1)?.[0].batched as (o: string) => void;
        // blank prints emit '' (0 chars) — the record-count budget must still cap
        for (let i = 0; i < 3000; i++) stdout('');
        // a Python `raise Exception('x' * 500000)`: the terminal record is exempt
        // from the record/char budget so it stays visible, but its OWN message
        // must still be bounded before it crosses Comlink and is persisted
        throw new Error(hugeMessage);
      });

      const result = await worker.runPython('...');

      // record count is bounded well below the flood, with exactly one marker
      expect(result.output.length).toBeLessThan(2100);
      expect(
        result.output.filter(
          (o: any) => typeof o.data === 'string' && o.data.includes('[output truncated]'),
        ),
      ).toHaveLength(1);
      // the exception is still visible even though ordinary output hit the cap…
      const terminal = result.output.at(-1);
      expect(terminal?.type).toBe('stderr');
      expect(terminal?.data.startsWith('x')).toBe(true);
      expect(terminal?.data).toContain('[error truncated]');
      // …but it is truncated, and NO returned record exceeds the declared bound
      for (const record of result.output as { data: string }[]) {
        expect(record.data.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 32);
      }
      expect(result.success).toBe(false);
    });

    it('should install packages using micropip', async () => {
      const packages = ['numpy', 'pandas'];

      await worker.installPackages(packages);

      expect(mockPyodide.loadPackage).toHaveBeenCalledWith('micropip');
      expect(mockMicropip.set_index_urls).toHaveBeenCalledWith([worker.pypiIndexUrl, 'PYPI']);
      expect(mockMicropip.install).toHaveBeenCalledWith(packages);
    });

    it('wraps the missing-wasm-wheel micropip error in a compatibility message', async () => {
      mockMicropip.install.mockRejectedValueOnce(
        new Error("Can't find a pure Python 3 wheel for: 'rpds-py>=0.25.0'"),
      );

      await expect(worker.installPackages(['jsonschema>=4.26'])).rejects.toThrow(
        /No Pyodide\/WebAssembly-compatible build exists for: jsonschema>=4\.26[\S\s]*Can't find a pure Python 3 wheel/,
      );
    });

    describe('prepareEnvironment (bundled-first package preparation)', () => {
      it('loads a bundled unversioned request via loadPackage and never micropip (jsonschema case)', async () => {
        await worker.prepareEnvironment('import jsonschema\nprint(1)', ['jsonschema']);

        expect(mockPyodide.loadPackagesFromImports).toHaveBeenCalledWith(
          'import jsonschema\nprint(1)',
        );
        expect(mockPyodide.loadPackage).toHaveBeenCalledWith(['jsonschema']);
        expect(mockMicropip.install).not.toHaveBeenCalled();
      });

      it('with no requested packages only loads the code imports', async () => {
        await worker.prepareEnvironment('import jsonschema', []);

        expect(mockPyodide.loadPackagesFromImports).toHaveBeenCalledWith('import jsonschema');
        expect(mockPyodide.loadPackage).not.toHaveBeenCalled();
        expect(mockMicropip.install).not.toHaveBeenCalled();
      });

      it('sends a non-bundled requirement to micropip AFTER the bundled import load', async () => {
        // the Python satisfaction filter reports it unsatisfied
        mockPyodide.runPythonAsync.mockResolvedValueOnce('["python-docx"]');

        await worker.prepareEnvironment('import docx', ['python-docx']);

        expect(mockMicropip.install).toHaveBeenCalledWith(['python-docx']);
        // ordering is the whole point: bundled/import loading must precede micropip
        const importsOrder = mockPyodide.loadPackagesFromImports.mock.invocationCallOrder[0];
        const micropipOrder = mockMicropip.install.mock.invocationCallOrder[0];
        expect(importsOrder).toBeLessThan(micropipOrder);
      });

      it('drops a versioned requirement the bundled version already satisfies', async () => {
        mockPyodide.runPythonAsync.mockResolvedValueOnce('[]');

        await worker.prepareEnvironment('import jsonschema', ['jsonschema>=4.20']);

        // bundled copy loaded so the check runs against 4.23.0, then satisfied
        expect(mockPyodide.loadPackage).toHaveBeenCalledWith(['jsonschema']);
        expect(mockPyodide.loadPackage).toHaveBeenCalledWith('packaging');
        expect(mockMicropip.install).not.toHaveBeenCalled();
      });

      it('never satisfies a direct URL reference from the bundled distribution (R9-5)', async () => {
        // the Python filter reports the URL requirement unsatisfied (req.url)
        mockPyodide.runPythonAsync.mockResolvedValueOnce(
          '["jsonschema @ https://example.com/custom-jsonschema.whl"]',
        );

        await worker.prepareEnvironment('import jsonschema', [
          'jsonschema @ https://example.com/custom-jsonschema.whl',
        ]);

        // the bundled copy must NOT be loaded for a direct reference, and the
        // exact requested artifact must reach micropip
        expect(mockPyodide.loadPackage).not.toHaveBeenCalledWith(['jsonschema']);
        expect(mockMicropip.install).toHaveBeenCalledWith([
          'jsonschema @ https://example.com/custom-jsonschema.whl',
        ]);
      });

      it('sends a direct URL for a non-bundled name to micropip untouched', async () => {
        mockPyodide.runPythonAsync.mockResolvedValueOnce(
          '["mylib @ https://example.com/mylib-1.0-py3-none-any.whl"]',
        );

        await worker.prepareEnvironment('import mylib', [
          'mylib @ https://example.com/mylib-1.0-py3-none-any.whl',
        ]);

        expect(mockMicropip.install).toHaveBeenCalledWith([
          'mylib @ https://example.com/mylib-1.0-py3-none-any.whl',
        ]);
      });

      it('still fails an explicitly incompatible pin, with the compatibility message', async () => {
        mockPyodide.runPythonAsync.mockResolvedValueOnce('["jsonschema>=4.26"]');
        mockMicropip.install.mockRejectedValueOnce(
          new Error("Can't find a pure Python 3 wheel for: 'rpds-py>=0.25.0'"),
        );

        await expect(
          worker.prepareEnvironment('import jsonschema', ['jsonschema>=4.26']),
        ).rejects.toThrow(/No Pyodide\/WebAssembly-compatible build exists/);
      });
    });

    it('should patch matplotlib when loaded', async () => {
      mockPyodide.loadedPackages = { matplotlib: true } as any;
      mockPyodide.runPythonAsync.mockResolvedValueOnce(undefined).mockResolvedValueOnce('ok');
      const res = await worker.runPython('print(1)');
      expect(res.success).toBe(true);
      expect(mockPyodide.runPythonAsync).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('patch_matplotlib()'),
      );
    });

    it('should write fonts into truetype directory before run', async () => {
      mockPyodide.runPythonAsync.mockResolvedValue('ok');
      await worker.runPython('print(1)');
      expect(mockPyodide.FS.mkdirTree).toHaveBeenCalledWith('/usr/share/fonts/truetype');
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('/usr/share/fonts/truetype/STSong.ttf'),
        expect.any(Uint8Array),
      );
    });

    it('should stringify non-string result', async () => {
      mockPyodide.runPythonAsync.mockResolvedValue({ toString: () => '42' });
      const r = await worker.runPython('1+41');
      expect(r.success).toBe(true);
      expect(r.result).toBe('42');
    });
  });
});
