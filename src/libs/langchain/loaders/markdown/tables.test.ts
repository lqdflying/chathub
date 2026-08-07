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

  it('does not alter pipe-like content inside a fenced code block', () => {
    const markdown = ['```text', '| value | --- |', '```'].join('\n');

    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
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

  it('keeps an oversized table as one atomic block', () => {
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
