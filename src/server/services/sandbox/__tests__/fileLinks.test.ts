import { describe, expect, it } from 'vitest';

import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

import {
  generatedFileLinksFromMessages,
  rewriteGeneratedFileLinks,
} from '../fileLinks';

const appOrigin = 'https://ai.aksg.net';
const pdf = {
  filename: 'jiaozi-su-xian.pdf',
  url: 'https://cdn.example/files/scope/1/recipe.pdf',
};
const report = {
  filename: 'report.pdf',
  url: 'https://cdn.example/files/scope/1/report.pdf',
};

describe('rewriteGeneratedFileLinks', () => {
  it('replaces a bare filename, a relative href, and a chat-host href', () => {
    const content = [
      '点这个文件就能下载:',
      'jiaozi-su-xian.pdf',
      '',
      '[配方](jiaozi-su-xian.pdf)',
      '',
      '[配方](https://ai.aksg.net/jiaozi-su-xian.pdf)',
    ].join('\n');

    expect(rewriteGeneratedFileLinks(content, [pdf], appOrigin)).toBe(
      [
        '点这个文件就能下载:',
        `[jiaozi-su-xian.pdf](${pdf.url})`,
        '',
        `[配方](${pdf.url})`,
        '',
        `[配方](${pdf.url})`,
      ].join('\n'),
    );
  });

  it('leaves other sites, code, titled-link labels, and longer filenames unchanged', () => {
    const content = [
      '[Source report](https://publisher.example/report.pdf)',
      '',
      '[Download](report.pdf "PDF report")',
      '',
      'Download report.pdf.zip',
      '',
      '```python',
      'open("report.pdf", "wb")',
      '```',
      '',
      '~~~~',
      'open("report.pdf", "wb")',
      '~~~~',
      '',
      '    open("report.pdf", "wb")',
      '',
      'Use `report.pdf` and ``open("report.pdf")`` in code.',
      '',
      '[proxy](https://ai.aksg.net/webapi/files/files/scope/1/recipe.pdf)',
      '',
      `[already](${report.url})`,
    ].join('\n');

    expect(rewriteGeneratedFileLinks(content, [report], appOrigin)).toBe(
      [
        '[Source report](https://publisher.example/report.pdf)',
        '',
        `[Download](${report.url} "PDF report")`,
        '',
        'Download report.pdf.zip',
        '',
        '```python',
        'open("report.pdf", "wb")',
        '```',
        '',
        '~~~~',
        'open("report.pdf", "wb")',
        '~~~~',
        '',
        '    open("report.pdf", "wb")',
        '',
        'Use `report.pdf` and ``open("report.pdf")`` in code.',
        '',
        '[proxy](https://ai.aksg.net/webapi/files/files/scope/1/recipe.pdf)',
        '',
        `[already](${report.url})`,
      ].join('\n'),
    );
  });

  it('leaves code fences and links that already open the stored file', () => {
    const content = [
      '```python',
      'open("jiaozi-su-xian.pdf", "wb")',
      '```',
      '',
      'Use `jiaozi-su-xian.pdf` in code.',
      '',
      '[proxy](https://ai.aksg.net/webapi/files/files/scope/1/recipe.pdf)',
      '',
      `[already](${pdf.url})`,
    ].join('\n');

    expect(rewriteGeneratedFileLinks(content, [pdf], appOrigin)).toBe(content);
  });

  it('reads code interpreter files from earlier tool messages', () => {
    expect(
      generatedFileLinksFromMessages([
        { content: 'hello', role: 'assistant' },
        {
          content: JSON.stringify({ files: [pdf], success: true }),
          plugin: { identifier: CodeInterpreterIdentifier },
          role: 'tool',
        },
        {
          content: JSON.stringify({
            files: [{ filename: 'other.pdf', url: 'https://cdn.example/other.pdf' }],
          }),
          plugin: { identifier: 'other-tool' },
          role: 'tool',
        },
      ]),
    ).toEqual([pdf]);
  });
});
