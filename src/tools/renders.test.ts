import { describe, expect, it } from 'vitest';

import { BuiltinToolsRenders, getBuiltinToolRender } from './renders';

describe('getBuiltinToolRender', () => {
  it('renders every Sandbox Hub profile, current or removed, with the Sandbox render', () => {
    const sandbox = BuiltinToolsRenders['lobe-sandbox'];
    expect(sandbox).toBeDefined();
    expect(getBuiltinToolRender('lobe-sandbox')).toBe(sandbox);
    expect(getBuiltinToolRender('lobe-code-interpreter')).toBe(sandbox);
    expect(getBuiltinToolRender('lobe-sandbox--data')).toBe(sandbox);
  });

  it('returns nothing for unknown or missing identifiers', () => {
    expect(getBuiltinToolRender('mcp__other')).toBeUndefined();
    expect(getBuiltinToolRender(undefined)).toBeUndefined();
    expect(getBuiltinToolRender('lobe-sandbox--Bad_Id')).toBeUndefined();
  });
});
