import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDebugConfig } from '../debug';

describe('getDebugConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return CHATHUB_DEBUG true when NEXT_PUBLIC_CHATHUB_DEBUG=1', () => {
    process.env.NEXT_PUBLIC_CHATHUB_DEBUG = '1';
    delete process.env.NEXT_PUBLIC_DEVELOPER_DEBUG;
    delete process.env.NEXT_PUBLIC_I18N_DEBUG;
    delete process.env.NEXT_PUBLIC_I18N_DEBUG_BROWSER;
    delete process.env.NEXT_PUBLIC_I18N_DEBUG_SERVER;

    const config = getDebugConfig();

    expect(config.CHATHUB_DEBUG).toBe(true);
    expect(config.DEBUG_MODE).toBe(false);
    expect(config.I18N_DEBUG).toBe(false);
    expect(config.I18N_DEBUG_BROWSER).toBe(false);
    expect(config.I18N_DEBUG_SERVER).toBe(false);
  });

  it('should return CHATHUB_DEBUG false when NEXT_PUBLIC_CHATHUB_DEBUG is unset', () => {
    delete process.env.NEXT_PUBLIC_CHATHUB_DEBUG;

    const config = getDebugConfig();

    expect(config.CHATHUB_DEBUG).toBe(false);
  });

  it('should return CHATHUB_DEBUG false for non-"1" values', () => {
    process.env.NEXT_PUBLIC_CHATHUB_DEBUG = 'true';

    const config = getDebugConfig();

    expect(config.CHATHUB_DEBUG).toBe(false);
  });

  it('should preserve existing flags alongside CHATHUB_DEBUG', () => {
    process.env.NEXT_PUBLIC_CHATHUB_DEBUG = '1';
    process.env.NEXT_PUBLIC_DEVELOPER_DEBUG = '1';
    process.env.NEXT_PUBLIC_I18N_DEBUG = '1';
    process.env.NEXT_PUBLIC_I18N_DEBUG_BROWSER = '1';
    process.env.NEXT_PUBLIC_I18N_DEBUG_SERVER = '1';

    const config = getDebugConfig();

    expect(config.CHATHUB_DEBUG).toBe(true);
    expect(config.DEBUG_MODE).toBe(true);
    expect(config.I18N_DEBUG).toBe(true);
    expect(config.I18N_DEBUG_BROWSER).toBe(true);
    expect(config.I18N_DEBUG_SERVER).toBe(true);
  });
});
