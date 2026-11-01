import { ToolNameResolver } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SANDBOX_PROFILE_ID,
  SANDBOX_PROFILE_ID_MAX_LENGTH,
  SandboxApiName,
  isSandboxToolIdentifier,
  isValidSandboxProfileId,
  normalizeBuiltinToolIds,
  parseSandboxToolIdentifier,
  resolveBuiltinToolAlias,
  resolveSandboxApiName,
  sandboxToolIdentifier,
} from './const';

describe('sandbox tool identifiers', () => {
  it('maps the retired Code Interpreter identifier and API to the Sandbox', () => {
    expect(resolveBuiltinToolAlias('lobe-code-interpreter')).toBe('lobe-sandbox');
    expect(resolveBuiltinToolAlias('lobe-web-browsing')).toBe('lobe-web-browsing');
    expect(resolveSandboxApiName('python')).toBe('runPython');
    expect(resolveSandboxApiName('runCommand')).toBe('runCommand');
    expect(isSandboxToolIdentifier('lobe-code-interpreter')).toBe(true);
    expect(isSandboxToolIdentifier('lobe-sandbox')).toBe(true);
    expect(isSandboxToolIdentifier('mcp__sandbox')).toBe(false);
    expect(isSandboxToolIdentifier(undefined)).toBe(false);
  });

  it('normalizes plugin lists without breaking referential stability', () => {
    const current = ['lobe-sandbox', 'mcp__notion'];
    expect(normalizeBuiltinToolIds(current)).toBe(current);

    const legacy = ['lobe-code-interpreter', 'mcp__notion', 'lobe-sandbox'];
    const normalized = normalizeBuiltinToolIds(legacy);
    expect(normalized).toEqual(['lobe-sandbox', 'mcp__notion']);
    expect(normalizeBuiltinToolIds(legacy)).toBe(normalized);
  });
});

describe('sandbox profile identifiers', () => {
  it('keeps lobe-sandbox for the general profile and namespaces the others', () => {
    expect(sandboxToolIdentifier(DEFAULT_SANDBOX_PROFILE_ID)).toBe('lobe-sandbox');
    expect(sandboxToolIdentifier('data')).toBe('lobe-sandbox--data');
    expect(parseSandboxToolIdentifier('lobe-sandbox')).toEqual({ profileId: 'general' });
    expect(parseSandboxToolIdentifier('lobe-code-interpreter')).toEqual({ profileId: 'general' });
    expect(parseSandboxToolIdentifier('lobe-sandbox--web-dev')).toEqual({ profileId: 'web-dev' });
    expect(isSandboxToolIdentifier('lobe-sandbox--web-dev')).toBe(true);
  });

  it.each([
    'lobe-sandbox--general',
    'lobe-sandbox--',
    'lobe-sandbox--Data',
    'lobe-sandbox--a_b',
    'lobe-sandbox--a--b',
    'lobe-sandbox--a-',
    'lobe-sandbox--1abc',
    `lobe-sandbox--${'a'.repeat(SANDBOX_PROFILE_ID_MAX_LENGTH + 1)}`,
    'lobe-sandboxdata',
    'mcp__lobe-sandbox--data',
  ])('rejects %s', (identifier) => {
    expect(parseSandboxToolIdentifier(identifier)).toBeUndefined();
    expect(isSandboxToolIdentifier(identifier)).toBe(false);
  });

  it('validates profile ids', () => {
    expect(isValidSandboxProfileId('data')).toBe(true);
    expect(isValidSandboxProfileId('web-dev2')).toBe(true);
    expect(isValidSandboxProfileId('')).toBe(false);
    expect(isValidSandboxProfileId('a'.repeat(SANDBOX_PROFILE_ID_MAX_LENGTH))).toBe(true);
  });

  it('never makes ToolNameResolver hash a profile tool name', () => {
    const resolver = new ToolNameResolver();
    const longest = sandboxToolIdentifier('a'.repeat(SANDBOX_PROFILE_ID_MAX_LENGTH));
    for (const apiName of Object.values(SandboxApiName)) {
      const name = resolver.generate(longest, apiName, 'builtin');
      expect(name.length, name).toBeLessThan(64);
      expect(name).not.toContain('MD5HASH_');
      expect(name.split('____')[0]).toBe(longest);
    }
  });
});
