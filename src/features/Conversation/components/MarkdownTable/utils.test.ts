import { describe, expect, it } from 'vitest';

import { extractTableRows, tableRowsToCsv, tableRowsToMarkdown } from './utils';

describe('extractTableRows', () => {
  it('extracts header and body cells from a rendered table', () => {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead><tr><th>Name</th><th>Age</th></tr></thead>
      <tbody>
        <tr><td>Alice</td><td>30</td></tr>
        <tr><td>Bob</td><td>25</td></tr>
      </tbody>
    `;

    expect(extractTableRows(table)).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  it('collapses inner whitespace from formatted cells', () => {
    const table = document.createElement('table');
    table.innerHTML = `<tr><td>  hello
      <strong>world</strong>  </td></tr>`;

    expect(extractTableRows(table)).toEqual([['hello world']]);
  });
});

describe('tableRowsToMarkdown', () => {
  it('serializes rows into a GFM table', () => {
    expect(
      tableRowsToMarkdown([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]),
    ).toBe(['| Name | Age |', '| --- | --- |', '| Alice | 30 |'].join('\n'));
  });

  it('escapes pipes and pads ragged rows', () => {
    expect(
      tableRowsToMarkdown([
        ['a|b', 'c'],
        ['only-one'],
      ]),
    ).toBe([String.raw`| a\|b | c |`, '| --- | --- |', '| only-one |  |'].join('\n'));
  });

  it('returns empty string for no rows', () => {
    expect(tableRowsToMarkdown([])).toBe('');
  });
});

describe('tableRowsToCsv', () => {
  it('serializes rows into CSV', () => {
    expect(
      tableRowsToCsv([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]),
    ).toBe('Name,Age\nAlice,30');
  });

  it('quotes cells containing commas, quotes, and newlines', () => {
    expect(tableRowsToCsv([['a,b', 'say "hi"', 'line1\nline2']])).toBe(
      '"a,b","say ""hi""","line1\nline2"',
    );
  });
});
