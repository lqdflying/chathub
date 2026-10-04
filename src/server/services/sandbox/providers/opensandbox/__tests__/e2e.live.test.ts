/** @vitest-environment node */
/**
 * Live checks against a real OpenSandbox server. Skipped unless
 * OPENSANDBOX_E2E_SERVER_URL is set; see
 * `.cursor/rules/sandbox-repro.mdc`.
 *
 *   OPENSANDBOX_E2E_SERVER_URL=http://127.0.0.1:8090 \
 *   OPENSANDBOX_E2E_API_KEY=... \
 *   OPENSANDBOX_E2E_IMAGE=chathub-sandbox:1 \
 *   npx vitest run src/server/services/sandbox/providers/opensandbox/__tests__/e2e.live.test.ts
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, describe, expect, it } from 'vitest';

import type { SandboxWorkspace } from '../../../types';
import { OpenSandboxClient } from '../client';
import { OpenSandboxProvider, SESSION_METADATA_KEY } from '../provider';

const serverUrl = process.env.OPENSANDBOX_E2E_SERVER_URL;

const provider = (session?: { sessionMaxLifetime?: number }) =>
  new OpenSandboxProvider({
    apiKey: process.env.OPENSANDBOX_E2E_API_KEY,
    baseUrl: serverUrl,
    image: process.env.OPENSANDBOX_E2E_IMAGE ?? 'chathub-sandbox:1',
    ...session,
  });

const client = () =>
  new OpenSandboxClient({ apiKey: process.env.OPENSANDBOX_E2E_API_KEY, baseUrl: serverUrl! });

const sessionKeys: string[] = [];

const newSessionKey = () => {
  const key = `e2e-${Date.now()}-${sessionKeys.length}`;
  sessionKeys.push(key);
  return key;
};

const sessionSandboxes = (sessionKey: string) =>
  client().findRunningSandboxes(
    { [SESSION_METADATA_KEY]: sessionKey },
    AbortSignal.timeout(10_000),
  );

const file = (filename: string, content: string) => ({
  content: new Uint8Array(Buffer.from(content)),
  filename,
});

const python = (
  p: OpenSandboxProvider,
  {
    code,
    files = [],
    sessionKey,
    timeoutMs = 60_000,
  }: {
    code: string;
    files?: ReturnType<typeof file>[];
    sessionKey?: string;
    timeoutMs?: number;
  },
) =>
  p.withWorkspace({ budgetMs: timeoutMs, sessionKey }, (workspace) =>
    workspace.runPython({
      code,
      inputs: files.map((item) => ({
        filename: item.filename,
        id: item.filename,
        load: async () => item.content,
      })),
      timeoutMs,
    }),
  );

const run = (code: string, files: ReturnType<typeof file>[] = [], timeoutMs?: number) =>
  python(provider(), { code, files, timeoutMs });

describe.runIf(serverUrl)('OpenSandbox live', () => {
  it('runs print, a trailing expression, stderr, subprocesses, and file removal', async () => {
    const result = await run(
      [
        'import os, subprocess, sys',
        'print("hello")',
        'os.makedirs("a/b", exist_ok=True)',
        'os.chdir("a"); os.chdir("..")',
        'open("tmp.txt", "w").write("x"); os.remove("tmp.txt")',
        'print(subprocess.run(["uname", "-s"], capture_output=True, text=True).stdout.strip())',
        'print("warn", file=sys.stderr)',
        '6 * 7',
      ].join('\n'),
    );

    expect(result).toMatchObject({
      files: [],
      stderr: 'warn',
      stdout: 'hello\nLinux\n42',
      success: true,
    });
  });

  it('round-trips files and turns plots into PNGs', async () => {
    const result = await run(
      [
        'import pandas as pd',
        'import matplotlib.pyplot as plt',
        'df = pd.read_csv("data.csv")',
        'df["c"] = df["a"] + df["b"]',
        'df.to_excel("out.xlsx", index=False)',
        'open("notes.txt", "a").write(" edited")',
        'plt.plot(df["a"], df["c"])',
        'plt.show()',
        'plt.figure(); plt.bar(["x"], [1])',
        'print(df.shape)',
      ].join('\n'),
      [file('data.csv', 'a,b\n1,2\n3,4\n'), file('notes.txt', 'orig'), file('keep.txt', 'same')],
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('(2, 3)');
    expect(result.files.map((item) => item.filename).sort()).toEqual([
      'notes.txt',
      'out.xlsx',
      'plot_1.png',
      'plot_2.png',
    ]);
    const png = result.files.find((item) => item.filename === 'plot_1.png');
    expect(Buffer.from(png!.content.subarray(0, 4)).toString('hex')).toBe('89504e47');
    const notes = result.files.find((item) => item.filename === 'notes.txt');
    expect(Buffer.from(notes!.content).toString()).toBe('orig edited');
  });

  it('renders Chinese text in charts and PDFs with the image fonts', async () => {
    const result = await run(
      [
        'import warnings',
        'warnings.simplefilter("error")',
        'import matplotlib.pyplot as plt',
        'plt.bar(["一月", "二月"], [1, 2]); plt.title("销售额"); plt.show()',
        'from reportlab.pdfbase import pdfmetrics',
        'from reportlab.pdfbase.ttfonts import TTFont',
        'from reportlab.platypus import SimpleDocTemplate, Paragraph',
        'from reportlab.lib.styles import getSampleStyleSheet',
        "pdfmetrics.registerFont(TTFont('STSong', 'STSong.ttf'))",
        'style = getSampleStyleSheet()["Normal"]; style.fontName = "STSong"',
        'SimpleDocTemplate("report.pdf").build([Paragraph("中文报告", style)])',
      ].join('\n'),
    );

    expect(result).toMatchObject({ stderr: '', success: true });
    expect(result.files.map((item) => item.filename).sort()).toEqual(['plot_1.png', 'report.pdf']);
  });

  it('gives every run a fresh sandbox', async () => {
    const first = await run('open("/tmp/leak.txt", "w").write("secret")');

    expect(first.success).toBe(true);
    expect(first.files.map((item) => item.filename)).toContain('leak.txt');
    expect((await run('import os\nprint(os.path.exists("/tmp/leak.txt"))')).stdout).toBe('False');
  });

  describe('session sandboxes', () => {
    afterAll(async () => {
      for (const key of sessionKeys) {
        for (const { id } of await sessionSandboxes(key)) {
          await client().deleteSandbox(id, AbortSignal.timeout(10_000));
        }
      }
    });

    it('keeps installs and files between runs of one session', async () => {
      const sessionKey = newSessionKey();
      const p = provider();
      const first = await python(p, {
        code: [
          // Installs like pip does: from a child process, into site-packages.
          'import subprocess, sys',
          'subprocess.run([sys.executable, "-c", "import site; open(site.getsitepackages()[0] + \'/e2e_installed.py\', \'w\').write(\'VALUE = 42\')"], check=True)',
          'open("prepared.txt", "w").write("step 1")',
          'import matplotlib.pyplot as plt',
          'plt.plot([1, 2]); plt.show()',
        ].join('\n'),
        sessionKey,
      });
      const [sandbox] = await sessionSandboxes(sessionKey);

      const second = await python(p, {
        code: [
          'import e2e_installed',
          'print(e2e_installed.VALUE, open("prepared.txt").read())',
          'import matplotlib.pyplot as plt',
          'plt.plot([2, 1]); plt.show()',
        ].join('\n'),
        sessionKey,
      });

      expect(first.files.map((item) => item.filename).sort()).toEqual(['plot_1.png', 'prepared.txt']);
      expect(second).toMatchObject({ stderr: '', stdout: '42 step 1', success: true });
      expect(second.files.map((item) => item.filename)).toEqual(['plot_2.png']);
      expect((await sessionSandboxes(sessionKey)).map((item) => item.id)).toEqual([sandbox.id]);
      expect(sandbox.createdAt).toBeGreaterThan(Date.now() - 120_000);
    });

    it('replaces a session sandbox once it nears an optional max lifetime', async () => {
      const sessionKey = newSessionKey();
      const timeoutMs = 5000;
      // Room for one 5s run plus the 120s margin, and 15s more.
      const sessionMaxLifetime = timeoutMs + 120_000 + 15_000;
      const p = provider({ sessionMaxLifetime });
      const input = { sessionKey, timeoutMs };

      await python(p, { ...input, code: 'open("/tmp/old.txt", "w").write("x")' });
      const [old] = await sessionSandboxes(sessionKey);
      const detail = (await (
        await fetch(`${serverUrl}/v1/sandboxes/${old.id}`, {
          headers: { 'OPEN-SANDBOX-API-KEY': process.env.OPENSANDBOX_E2E_API_KEY ?? '' },
        })
      ).json()) as { expiresAt: string };
      // Parked until the cap, not for the 30 min idle timeout.
      expect(Math.abs(Date.parse(detail.expiresAt) - (old.createdAt! + sessionMaxLifetime))).toBeLessThan(
        1000,
      );
      await sleep(Math.max(0, old.createdAt! + 16_000 - Date.now()));

      const second = await python(p, {
        ...input,
        code: 'import os\nprint(os.path.exists("/tmp/old.txt"))',
      });

      expect(second.stdout).toBe('False');
      const current = await sessionSandboxes(sessionKey);
      expect(current).toHaveLength(1);
      expect(current[0].id).not.toBe(old.id);
    });

    it('runs shell commands, background processes, and file operations in one sandbox', async () => {
      const sessionKey = newSessionKey();
      const p = provider();
      const use = <T>(task: (workspace: SandboxWorkspace) => Promise<T>) =>
        p.withWorkspace({ budgetMs: 60_000, sessionKey }, task);

      const tools = await use((workspace) =>
        workspace.exec({
          command: 'git --version && node --version && npm --version && rg --version | head -1',
          timeoutMs: 30_000,
        }),
      );
      expect(tools).toMatchObject({ exitCode: 0, timedOut: false });
      expect(tools.stdout).toMatch(/git version/);
      expect(tools.stdout).toMatch(/^v\d+\./m);

      await use((workspace) =>
        workspace.writeFile(
          `${workspace.workdir}/app/server.js`,
          new Uint8Array(
            Buffer.from(
              "require('http').createServer((q, s) => s.end('pong')).listen(3000, () => console.log('ready'));",
            ),
          ),
        ),
      );
      const commandId = await use((workspace) =>
        workspace.startBackground({ command: 'node app/server.js' }),
      );
      await sleep(1500);
      const { logs, status } = await use(async (workspace) => ({
        logs: await workspace.commandLogs(commandId),
        status: await workspace.commandStatus(commandId),
      }));
      expect(status.running).toBe(true);
      expect(logs.output).toContain('ready');
      expect(logs.cursor).toBeGreaterThan(0);

      const curl = await use((workspace) =>
        workspace.exec({ command: 'curl -s localhost:3000', timeoutMs: 10_000 }),
      );
      expect(curl.stdout).toBe('pong');

      await use((workspace) => workspace.interrupt(commandId));
      await sleep(500);
      expect((await use((workspace) => workspace.commandStatus(commandId))).running).toBe(false);

      const listing = await use((workspace) => workspace.listDirectory(workspace.workdir, 2));
      expect(listing.map((entry) => entry.path)).toContain('/tmp/workspace/app/server.js');
      const read = await use((workspace) =>
        workspace.readFile('/tmp/workspace/app/server.js', 1024 * 1024),
      );
      expect(Buffer.from(read).toString()).toContain('pong');
    });
  });

  it('reports exceptions as plain-text user tracebacks', async () => {
    const result = await run('def f():\n    raise ValueError("boom")\nf()');

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('raise ValueError("boom")');
    expect(result.stderr).toContain('ValueError: boom');
    expect(result.stderr).not.toContain('run.py');
  });

  it('times out on the run budget', async () => {
    await expect(run('import time\ntime.sleep(60)', [], 3000)).rejects.toMatchObject({
      code: 'Timeout',
    });
  });

  it('does not wait for a background child that keeps the output pipe open', async () => {
    const started = Date.now();
    const result = await run(
      'import subprocess\nsubprocess.Popen(["sleep", "30"])\nprint("done")',
      [],
      15_000,
    );

    expect(result).toMatchObject({ stdout: 'done', success: true });
    expect(Date.now() - started).toBeLessThan(15_000);
  });
}, 120_000);
