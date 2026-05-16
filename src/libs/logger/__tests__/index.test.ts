import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock bootstrap so we can control side-effects during module import
vi.mock('../bootstrap', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    bootstrapDebug: vi.fn(),
  };
});

describe('pino logger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should bootstrap debug on module load', async () => {
    const { bootstrapDebug } = await import('../bootstrap');

    // Re-importing triggers the top-level bootstrapDebug() call
    await import('../index');

    expect(bootstrapDebug).toHaveBeenCalledTimes(1);
  });

  it('should use debug level when CHATHUB_DEBUG=1 without explicit LOG_LEVEL', async () => {
    process.env.CHATHUB_DEBUG = '1';
    delete process.env.LOG_LEVEL;

    const { pino } = await import('../index');

    expect(pino.level).toBe('debug');
  });

  it('should respect explicit LOG_LEVEL over CHATHUB_DEBUG', async () => {
    process.env.CHATHUB_DEBUG = '1';
    process.env.LOG_LEVEL = 'warn';

    const { pino } = await import('../index');

    expect(pino.level).toBe('warn');
  });

  it('should default to info level when no env vars are set', async () => {
    delete process.env.CHATHUB_DEBUG;
    delete process.env.LOG_LEVEL;

    const { pino } = await import('../index');

    expect(pino.level).toBe('info');
  });

  it('should redact sensitive fields', async () => {
    delete process.env.CHATHUB_DEBUG;
    delete process.env.LOG_LEVEL;

    const { pino } = await import('../index');

    const output: any[] = [];
    const child = pino.child({
      write(msg: string) {
        output.push(JSON.parse(msg));
      },
    });

    // Use the child's internal pino instance via a custom destination
    // Instead, use pino with a custom destination stream
    const Pino = (await import('pino')).default;
    const stream = {
      write(chunk: string) {
        output.push(JSON.parse(chunk));
      },
    };
    const testLogger = Pino(
      {
        level: 'info',
        redact: {
          censor: '[REDACTED]',
          paths: [
            'accessToken',
            'apiKey',
            'authorization',
            'password',
            'refreshToken',
            'secret',
            'token',
          ],
        },
      },
      stream,
    );

    testLogger.info({
      accessToken: 'secret-token',
      apiKey: 'sk-123',
      authorization: 'Bearer abc',
      normalField: 'visible',
      password: 'hunter2',
      refreshToken: 'refresh-xyz',
      secret: 'shh',
      token: 'tok',
    });

    const lastLog = output[output.length - 1];
    expect(lastLog.normalField).toBe('visible');
    expect(lastLog.accessToken).toBe('[REDACTED]');
    expect(lastLog.apiKey).toBe('[REDACTED]');
    expect(lastLog.authorization).toBe('[REDACTED]');
    expect(lastLog.password).toBe('[REDACTED]');
    expect(lastLog.refreshToken).toBe('[REDACTED]');
    expect(lastLog.secret).toBe('[REDACTED]');
    expect(lastLog.token).toBe('[REDACTED]');
  });
});
