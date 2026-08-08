import { describe, expect, it } from 'vitest';

import { normalizeMarkdownTables, splitMarkdownIntoBlocks } from './tables';

describe('normalizeMarkdownTables', () => {
  it('puts a separator merged onto a header onto its own line', () => {
    const normalizedMarkdown = normalizeMarkdownTables(
      ['# Inventory', '| Item | Quantity || --- | --- |', '| Pens | 12 |'].join('\n'),
    );

    expect(normalizedMarkdown).toBe(
      ['# Inventory', '| Item | Quantity |', '| --- | --- |', '| Pens | 12 |'].join('\n'),
    );
  });

  it('preserves blank lines and indentation outside targeted table repairs', () => {
    const markdown = [
      '    indented text',
      '',
      '',
      'Paragraph one.',
      '',
      '',
      '',
      'Paragraph two.',
      '',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  it('preserves consecutive blank lines inside a fenced code block', () => {
    const markdown = [
      '```python',
      'def a():',
      '    pass',
      '',
      '',
      'def b():',
      '    pass',
      '```',
    ].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  it.each([
    {
      markdown: ['````text', '```', '| Item | Value || --- | --- |', '```', '````'].join('\n'),
      name: 'a shorter backtick fence',
    },
    {
      markdown: ['````text', '~~~', '| Item | Value || --- | --- |', '~~~', '````'].join('\n'),
      name: 'a different fence delimiter',
    },
    {
      markdown: ['````text', '```` invalid', '| Item | Value || --- | --- |', '`````'].join('\n'),
      name: 'a closer with an invalid suffix',
    },
    {
      markdown: ['   ~~~~text', '| Item | Value || --- | --- |', '   ~~~~~'].join('\n'),
      name: 'an indented tilde fence with a longer closer',
    },
    {
      markdown: ['```text', '| Item | Value || --- | --- |'].join('\n'),
      name: 'an unclosed fence',
    },
  ])('does not repair table syntax inside $name', ({ markdown }) => {
    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  it.each(['| --- | --- |', 'Use `a | b` then | --- | --- |', 'Use a \\| b then | --- | --- |'])(
    'does not mutate non-table separator-like content: %s',
    (markdown) => {
      expect(normalizeMarkdownTables(markdown)).toBe(markdown);
    },
  );

  it('requires matching header and separator column counts before repairing', () => {
    const markdown = '| A | B | C || --- | --- |';

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  it('repairs a merged separator exactly once', () => {
    const markdown = ['# Inventory', '| Item | Quantity || --- | --- |', '| Pens | 12 |'].join(
      '\n',
    );
    const normalizedMarkdown = normalizeMarkdownTables(markdown);

    expect(normalizeMarkdownTables(normalizedMarkdown)).toBe(normalizedMarkdown);
  });
});

describe('splitMarkdownIntoBlocks', () => {
  it('keeps every table row with its header and separator', () => {
    const markdown = normalizeMarkdownTables(
      [
        '# Report',
        '',
        '| Quarter | Revenue |',
        '| --- | ---: |',
        '| Q1 | 100 |',
        '| Q2 | 200 |',
        '',
        'Closing notes.',
      ].join('\n'),
    );

    expect(splitMarkdownIntoBlocks(markdown)).toEqual([
      { content: '# Report', type: 'text' },
      {
        content: ['| Quarter | Revenue |', '| --- | ---: |', '| Q1 | 100 |', '| Q2 | 200 |'].join(
          '\n',
        ),
        type: 'table',
      },
      { content: 'Closing notes.', type: 'text' },
    ]);
  });

  it('returns a structurally detected table as one block for the loader', () => {
    const rows = Array.from(
      { length: 100 },
      (_, index) => `| Row ${index + 1} | Value ${index + 1} |`,
    );
    const markdown = normalizeMarkdownTables(
      ['| Name | Value |', '| --- | --- |', ...rows].join('\n'),
    );

    const blocks = splitMarkdownIntoBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      content: ['| Name | Value |', '| --- | --- |', ...rows].join('\n'),
      type: 'table',
    });
  });
});
