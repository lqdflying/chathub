import { describe, expect, it } from 'vitest';

import { SandboxIdentifier } from '@/tools/sandbox/const';

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
const plot = {
  filename: 'plot.png',
  url: 'https://cdn.example/files/scope/1/plot.png',
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

  it('keeps formatted labels, image alt text, and raw external URLs', () => {
    const content = [
      '[**report.pdf**](report.pdf)',
      '',
      'Keep this paragraph.',
      '',
      '[**report.pdf**](https://publisher.example/report.pdf)',
      '',
      '![Chart of sales](plot.png "Q1")',
      '',
      'https://publisher.example/download?filename=report.pdf',
      '',
      'https://publisher.example/redirect?url=https://ai.aksg.net/report.pdf',
      '',
      '[Original](https://ai.aksg.net/report.pdf?rev=1)',
      '',
      '[**report.pdf**][src]',
      '',
      '[src]: https://publisher.example/report.pdf',
    ].join('\n');

    expect(rewriteGeneratedFileLinks(content, [report, plot], appOrigin)).toBe(
      [
        `[**report.pdf**](${report.url})`,
        '',
        'Keep this paragraph.',
        '',
        '[**report.pdf**](https://publisher.example/report.pdf)',
        '',
        `![Chart of sales](${plot.url} "Q1")`,
        '',
        'https://publisher.example/download?filename=report.pdf',
        '',
        'https://publisher.example/redirect?url=https://ai.aksg.net/report.pdf',
        '',
        '[Original](https://ai.aksg.net/report.pdf?rev=1)',
        '',
        '[**report.pdf**][src]',
        '',
        '[src]: https://publisher.example/report.pdf',
      ].join('\n'),
    );
  });

  it('keeps destination whitespace, titles, and foreign query punctuation', () => {
    const content = [
      '[Download]( report.pdf )',
      '',
      '[Download](',
      'report.pdf',
      '"PDF")',
      '',
      '[Download]( <report.pdf> "PDF")',
      '',
      '[Download](report.pdf "Use ]( here")',
      '',
      'https://publisher.example/download?label=(PDF)&filename=report.pdf',
      '',
      'https://publisher.example/download?filter[0]=report.pdf',
      '',
      'See https://ai.aksg.net/report.pdf.',
    ].join('\n');

    expect(rewriteGeneratedFileLinks(content, [report], appOrigin)).toBe(
      [
        `[Download]( ${report.url} )`,
        '',
        '[Download](',
        report.url,
        '"PDF")',
        '',
        `[Download]( <${report.url}> "PDF")`,
        '',
        `[Download](${report.url} "Use ]( here")`,
        '',
        'https://publisher.example/download?label=(PDF)&filename=report.pdf',
        '',
        'https://publisher.example/download?filter[0]=report.pdf',
        '',
        `See ${report.url}.`,
      ].join('\n'),
    );
  });

  it('reads code interpreter files from earlier tool messages', () => {
    expect(
      generatedFileLinksFromMessages([
        { content: 'hello', role: 'assistant' },
        {
          content: JSON.stringify({ files: [pdf], success: true }),
          plugin: { identifier: SandboxIdentifier },
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
