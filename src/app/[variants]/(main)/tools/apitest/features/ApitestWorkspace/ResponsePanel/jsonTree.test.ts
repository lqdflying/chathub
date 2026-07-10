import { describe, expect, it } from 'vitest';

import { type JsonTreeNode, buildJsonTree, parseJsonValue } from './jsonTree';

const requireTree = (value: Parameters<typeof buildJsonTree>[0], nodeLimit = 100): JsonTreeNode => {
  const result = buildJsonTree(value, nodeLimit);
  expect(result.exceededLimit).toBe(false);
  if (result.exceededLimit) throw new Error('Expected JSON tree data');
  return result.data.root;
};

describe('parseJsonValue', () => {
  it('parses valid objects, arrays, and top-level primitives', () => {
    expect(parseJsonValue('{"enabled":true}')).toEqual({
      parsed: true,
      value: { enabled: true },
    });
    expect(parseJsonValue('[1,null]')).toEqual({ parsed: true, value: [1, null] });
    expect(parseJsonValue('"ready"')).toEqual({ parsed: true, value: 'ready' });
  });

  it('rejects empty and malformed input', () => {
    expect(parseJsonValue('')).toEqual({ parsed: false });
    expect(parseJsonValue('{"unfinished":')).toEqual({ parsed: false });
  });
});

describe('buildJsonTree', () => {
  it('preserves nested objects, arrays, labels, counts, and primitive types', () => {
    const root = requireTree({
      data: [
        {
          active: true,
          count: 2,
          empty: null,
          name: 'alpha',
        },
      ],
    });

    expect(root).toMatchObject({
      childCount: 1,
      key: '$',
      label: '$',
      labelType: 'root',
      type: 'object',
    });

    if (root.type !== 'object') throw new Error('Expected object root');
    const dataNode = root.children[0];
    expect(dataNode).toMatchObject({
      childCount: 1,
      key: '$/data',
      label: 'data',
      labelType: 'key',
      type: 'array',
    });

    if (dataNode.type !== 'array') throw new Error('Expected array node');
    const itemNode = dataNode.children[0];
    expect(itemNode).toMatchObject({
      childCount: 4,
      key: '$/data/0',
      label: '0',
      labelType: 'index',
      type: 'object',
    });

    if (itemNode.type !== 'object') throw new Error('Expected object item');
    expect(itemNode.children).toMatchObject([
      { label: 'active', type: 'boolean', value: true },
      { label: 'count', type: 'number', value: 2 },
      { label: 'empty', type: 'null', value: null },
      { label: 'name', type: 'string', value: 'alpha' },
    ]);
  });

  it('escapes JSON pointer path segments without collisions', () => {
    const root = requireTree({
      'a/b': 1,
      'a~1b': 2,
      '~': 3,
    });

    if (root.type !== 'object') throw new Error('Expected object root');
    expect(root.children.map((node) => node.key)).toEqual(['$/a~1b', '$/a~01b', '$/~0']);
  });

  it('expands the root and direct container children initially', () => {
    const result = buildJsonTree({ data: [{ nested: { value: 1 } }], meta: { page: 1 } }, 100);
    if (result.exceededLimit) throw new Error('Expected JSON tree data');

    expect(result.data.initialExpandedKeys).toEqual(['$/data', '$/meta', '$']);
  });

  it('supports a top-level scalar as the synthetic root value', () => {
    expect(requireTree(false)).toEqual({
      key: '$',
      label: '$',
      labelType: 'root',
      type: 'boolean',
      value: false,
    });
  });

  it('returns overflow instead of a partial tree beyond the node limit', () => {
    expect(buildJsonTree({ first: 1, second: 2 }, 2)).toEqual({ exceededLimit: true });

    const exactLimitResult = buildJsonTree({ first: 1, second: 2 }, 3);
    expect(exactLimitResult.exceededLimit).toBe(false);
  });
});
