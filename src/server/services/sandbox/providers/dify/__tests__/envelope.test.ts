import { describe, expect, it } from 'vitest';

import {
  CI_FILES_SENTINEL_PREFIX,
  parseSandboxEnvelope,
  wrapSandboxPython,
} from '../envelope';

describe('Dify sandbox envelope', () => {
  it('embeds user code and input files as base64, not raw source', () => {
    const wrapped = wrapSandboxPython({
      code: 'print("secret-source")',
      files: [{ contentBase64: Buffer.from('hello').toString('base64'), filename: '../etc/passwd' }],
      maxFileBytes: 1024,
      token: 'abc123',
    });

    expect(wrapped).toContain('MPLBACKEND');
    expect(wrapped).toContain('/mnt/data');
    expect(wrapped).not.toContain('print("secret-source")');
    expect(wrapped).not.toContain('../etc/passwd');
    expect(wrapped).toContain(Buffer.from('print("secret-source")', 'utf8').toString('base64'));
    expect(wrapped).toContain(
      Buffer.from(
        JSON.stringify([{ b64: Buffer.from('hello').toString('base64'), name: 'passwd' }]),
        'utf8',
      ).toString('base64'),
    );
  });

  it('parses stdout before the sentinel and decodes output files', () => {
    const token = 'deadbeef';
    const payload = {
      files: [{ b64: Buffer.from('plot-bytes').toString('base64'), name: '/mnt/data/plot_1.png' }],
      success: true,
    };
    const stdout = `hello world\n${CI_FILES_SENTINEL_PREFIX}${token}>>>\n${JSON.stringify(payload)}`;

    const parsed = parseSandboxEnvelope({
      maxFileBytes: 1024,
      maxFileCount: 8,
      stdout,
      token,
    });

    expect(parsed.wrapperPresent).toBe(true);
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toBe('hello world');
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].filename).toBe('plot_1.png');
    expect(Buffer.from(parsed.files[0].content).toString()).toBe('plot-bytes');
  });

  it('drops oversized files and treats missing sentinels as incomplete', () => {
    const token = 'token';
    const huge = Buffer.alloc(16, 1).toString('base64');
    const stdout = `${CI_FILES_SENTINEL_PREFIX}${token}>>>\n${JSON.stringify({
      files: [{ b64: huge, name: 'too-big.bin' }],
      success: true,
    })}`;

    expect(
      parseSandboxEnvelope({ maxFileBytes: 8, maxFileCount: 4, stdout, token }).files,
    ).toEqual([]);
    expect(
      parseSandboxEnvelope({
        maxFileBytes: 1024,
        maxFileCount: 4,
        stdout: 'no wrapper',
        token,
      }),
    ).toMatchObject({ success: true, wrapperPresent: false, stdout: 'no wrapper' });
  });
});
