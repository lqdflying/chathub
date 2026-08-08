// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { loaderConfig } from '../../config';
import { MarkdownLoader } from '../index';

describe('MarkdownLoader', () => {
  it('should run', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.mdx`), 'utf8');

    await MarkdownLoader(content);
  });

  it('keeps an under-limit GFM table in one byte-identical document', async () => {
    const table = [
      '| Name | Value | Notes |',
      '| :--- | ---: | :---: |',
      '| Café | 12 | escaped \\| pipe |',
      '| 東京 | 23 | `inline code` |',
    ].join('\n');

    const documents = await MarkdownLoader(
      ['# Inventory', '', table, '', 'Closing notes.'].join('\n'),
    );
    const tableDocuments = documents.filter((document) =>
      document.pageContent.includes('| Name | Value |'),
    );

    expect(tableDocuments).toHaveLength(1);
    expect(tableDocuments[0].pageContent).toBe(table);
    expect(
      documents.filter((document) => document.pageContent.includes('| :--- | ---: | :---: |')),
    ).toEqual(tableDocuments);
  });

  it('splits a many-row table into bounded valid table documents', async () => {
    const rows = Array.from(
      { length: 500 },
      (_, index) => `| Row ${index + 1} | Value ${index + 1} |`,
    );
    const header = '| Name | Value |';
    const separator = '| --- | --- |';

    const documents = await MarkdownLoader([header, separator, ...rows].join('\n'));

    expect(documents.length).toBeGreaterThan(1);
    expect(
      documents.every(
        (document) =>
          document.pageContent.startsWith(`${header}\n${separator}\n`) &&
          document.pageContent.length <= loaderConfig.chunkSize,
      ),
    ).toBe(true);

    const emittedRows = documents.flatMap((document) => document.pageContent.split('\n').slice(2));
    expect(emittedRows).toEqual(rows);
  });

  it('emits bounded labeled continuations when one cell cannot fit in a table page', async () => {
    const giantCell = `${'多语言内容🙂'.repeat(160)} escaped \\| pipe`;
    const table = ['| Name | Notes |', '| --- | --- |', `| Oversized row | ${giantCell} |`].join(
      '\n',
    );

    const documents = await MarkdownLoader(table);

    expect(documents.length).toBeGreaterThan(1);
    expect(
      documents.every(
        (document) =>
          document.pageContent.length > 0 && document.pageContent.length <= loaderConfig.chunkSize,
      ),
    ).toBe(true);
    expect(
      documents.some((document) =>
        document.pageContent.includes('**Table row 1, column 2/2 (Notes)**'),
      ),
    ).toBe(true);

    const continuationText = documents
      .filter((document) => document.pageContent.includes('column 2/2'))
      .map((document) => document.pageContent.split('\n\n').at(-1))
      .join('');
    expect(continuationText).toBe(giantCell);
  });
});
