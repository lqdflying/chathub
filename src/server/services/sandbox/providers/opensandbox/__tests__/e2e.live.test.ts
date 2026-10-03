/** @vitest-environment node */
/**
 * Live checks against a real OpenSandbox server. Skipped unless
 * OPENSANDBOX_E2E_SERVER_URL is set; see
 * `.cursor/rules/code-interpreter-sandbox-repro.mdc`.
 *
 *   OPENSANDBOX_E2E_SERVER_URL=http://127.0.0.1:8090 \
 *   OPENSANDBOX_E2E_API_KEY=... \
 *   OPENSANDBOX_E2E_IMAGE=chathub-sandbox-python:1 \
 *   npx vitest run src/server/services/sandbox/providers/opensandbox/__tests__/e2e.live.test.ts
 */
import { describe, expect, it } from 'vitest';

import { OpenSandboxProvider } from '../provider';

const serverUrl = process.env.OPENSANDBOX_E2E_SERVER_URL;

const provider = () =>
  new OpenSandboxProvider({
    apiKey: process.env.OPENSANDBOX_E2E_API_KEY,
    baseUrl: serverUrl,
    image: process.env.OPENSANDBOX_E2E_IMAGE ?? 'chathub-sandbox-python:1',
  });

const file = (filename: string, content: string) => ({
  content: new Uint8Array(Buffer.from(content)),
  filename,
});

const run = (code: string, files: ReturnType<typeof file>[] = [], timeoutMs?: number) =>
  provider().run({ code, files, language: 'python3', timeoutMs });

describe.runIf(serverUrl)('OpenSandbox live', () => {
  it('runs print, a trailing expression, stderr, and syscalls Dify blocked', async () => {
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
