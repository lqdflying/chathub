import { describe, expect, it } from 'vitest';

import {
  isSandboxToolIdentifier,
  normalizeBuiltinToolIds,
  resolveBuiltinToolAlias,
  resolveSandboxApiName,
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
