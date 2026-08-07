// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { MarkdownLoader } from '../index';

describe('MarkdownLoader', () => {
  it('should run', async () => {
    const content = fs.readFileSync(join(__dirname, `./demo.mdx`), 'utf8');

    await MarkdownLoader(content);
  });

  it('keeps an oversized GFM table in one document', async () => {
    const rows = Array.from(
      { length: 150 },
      (_, index) => `| Row ${index + 1} | Value ${index + 1} |`,
    );
    const table = ['| Name | Value |', '| --- | --- |', ...rows].join('\n');

    const documents = await MarkdownLoader(
      ['# Inventory', '', table, '', 'Closing notes.'].join('\n'),
    );
    const tableDocuments = documents.filter((document) =>
      document.pageContent.includes('| Name | Value |'),
    );

    expect(tableDocuments).toHaveLength(1);
    expect(tableDocuments[0].pageContent).toBe(table);
    expect(documents.filter((document) => document.pageContent.includes('| --- | --- |'))).toEqual(
      tableDocuments,
    );
  });
});
