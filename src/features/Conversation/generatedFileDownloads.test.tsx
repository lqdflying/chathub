import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppLink from '@/layout/GlobalProvider/AppLink';
import { setIosDownloadUi } from '@/utils/client/downloadFile';

import { SandboxFileDownloadSync } from './SandboxFileDownloads';
import {
  lookupGeneratedFileDownload,
  readSandboxFileDownloads,
  replaceGeneratedFileDownloads,
} from './generatedFileDownloads';

vi.stubGlobal('React', React);

const getFile = vi.hoisted(() => vi.fn());

vi.mock('@/services/file', () => ({
  fileService: { getFile: (...args: unknown[]) => getFile(...args) },
}));

const messages = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { messages: unknown[] }) => unknown) =>
    selector({ messages: messages.current }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    mainAIChatsRaw: (state: { messages: unknown[] }) => state.messages,
  },
}));

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const toolMessage = (identifier: string, files: unknown[]) => ({
  content: JSON.stringify({ files }),
  plugin: { identifier },
  role: 'tool',
});

class ChatBoundary extends React.Component<
  { children: React.ReactNode; onError: (_error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? <div>chat failed</div> : this.props.children;
  }
}

describe('readSandboxFileDownloads', () => {
  it('keeps public-domain and public-ACL outputs and ignores other tools', () => {
    expect(
      readSandboxFileDownloads([
        { content: 'see the file', role: 'assistant' },
        toolMessage('lobe-sandbox', [
          {
            fileId: 'pub',
            filename: 'nested/report.docx',
            url: 'https://cdn.example/files/scope/report.docx',
          },
          { filename: 'missing-id.txt', url: 'https://cdn.example/missing-id.txt' },
        ]),
        toolMessage('lobe-code-interpreter', [
          {
            fileId: 'acl',
            filename: 'sheet.xlsx',
            url: 'https://bucket.s3.amazonaws.com/files/scope/sheet.xlsx',
          },
        ]),
        toolMessage('other-plugin', [
          { fileId: 'nope', filename: 'skip.pdf', url: 'https://cdn.example/skip.pdf' },
        ]),
      ]),
    ).toEqual([
      {
        fileId: 'pub',
        filename: 'report.docx',
        url: 'https://cdn.example/files/scope/report.docx',
      },
      {
        fileId: 'acl',
        filename: 'sheet.xlsx',
        url: 'https://bucket.s3.amazonaws.com/files/scope/sheet.xlsx',
      },
    ]);
  });

  it('skips malformed historical tool content and keeps a valid output', () => {
    const url = 'https://cdn.example/files/scope/report.docx';

    expect(
      readSandboxFileDownloads([
        { content: null, plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
        { content: 'null', plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
        { content: 'not json', plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
        { content: '{"files":{}}', plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
        {
          content: '{"files":[null,"nope",{"fileId":1}]}',
          plugin: { identifier: 'lobe-sandbox' },
          role: 'tool',
        },
        {
          content: JSON.stringify({
            files: [null, { fileId: 'pub', filename: 'report.docx', url }],
          }),
          plugin: { identifier: 'lobe-code-interpreter' },
          role: 'tool',
        },
      ]),
    ).toEqual([{ fileId: 'pub', filename: 'report.docx', url }]);
  });
});

describe('installed app public storage links', () => {
  const share = vi.fn();
  const reportError = vi.fn();

  beforeEach(() => {
    share.mockReset();
    share.mockResolvedValue(undefined);
    reportError.mockReset();
    getFile.mockReset();
    replaceGeneratedFileDownloads([]);
    vi.stubGlobal('React', React);
    vi.stubGlobal('navigator', {
      canShare: () => true,
      maxTouchPoints: 5,
      share,
      standalone: true,
      userActivation: { isActive: true },
      userAgent: IPHONE,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        blob: async () => new Blob(['document'], { type: 'application/octet-stream' }),
        ok: true,
        status: 200,
        statusText: 'OK',
      })),
    );
    vi.spyOn(window, 'open').mockImplementation(() => null);
    setIosDownloadUi({ promptSave: vi.fn(), reportError });
  });

  afterEach(() => {
    replaceGeneratedFileDownloads([]);
    setIosDownloadUi(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    {
      fileId: 'pub',
      filename: 'report.docx',
      url: 'https://cdn.example/files/scope/report.docx',
    },
    {
      fileId: 'acl',
      filename: 'sheet.xlsx',
      url: 'https://bucket.s3.amazonaws.com/files/scope/sheet.xlsx',
    },
  ])('saves $filename through the file proxy', async ({ fileId, filename, url }) => {
    const proxy = `${location.origin}/webapi/files/scope/${fileId}`;
    getFile.mockResolvedValue({ url: proxy });
    replaceGeneratedFileDownloads([{ fileId, filename, url }]);
    render(<AppLink href={url}>{filename}</AppLink>);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(false);

    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(getFile).toHaveBeenCalledWith(fileId);
    expect(fetch).toHaveBeenCalledWith(proxy, expect.objectContaining({ credentials: 'include' }));
    expect(share.mock.calls[0][0].files[0].name).toBe(filename);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('leaves an unrelated external link alone', () => {
    replaceGeneratedFileDownloads([
      {
        fileId: 'pub',
        filename: 'report.docx',
        url: 'https://cdn.example/files/scope/report.docx',
      },
    ]);
    render(<AppLink href="https://example.com/docs">Docs</AppLink>);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(true);
    expect(getFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('reports a lookup failure without opening a window', async () => {
    const url = 'https://cdn.example/files/scope/report.docx';
    getFile.mockRejectedValue(new Error('missing'));
    replaceGeneratedFileDownloads([{ fileId: 'pub', filename: 'report.docx', url }]);
    render(<AppLink href={url}>report.docx</AppLink>);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(false);
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith('fetch_failed'));
    expect(share).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('SandboxFileDownloadSync', () => {
  afterEach(() => {
    replaceGeneratedFileDownloads([]);
    messages.current = [];
  });

  it('registers sandbox files from the current chat and clears them on unmount', () => {
    const url = 'https://cdn.example/files/scope/report.docx';
    messages.current = [
      toolMessage('lobe-sandbox', [{ fileId: 'pub', filename: 'report.docx', url }]),
    ];
    const view = render(<SandboxFileDownloadSync />);

    expect(lookupGeneratedFileDownload(url)?.fileId).toBe('pub');

    view.unmount();
    expect(lookupGeneratedFileDownload(url)).toBeUndefined();
  });

  it('registers a valid output when historical tool content is malformed', () => {
    const onError = vi.fn();
    const url = 'https://cdn.example/files/scope/report.docx';
    messages.current = [
      { content: null, plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
      { content: 'null', plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
      { content: 'not json', plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
      { content: '{"files":{}}', plugin: { identifier: 'lobe-sandbox' }, role: 'tool' },
      {
        content: '{"files":[null,"nope"]}',
        plugin: { identifier: 'lobe-sandbox' },
        role: 'tool',
      },
      toolMessage('lobe-code-interpreter', [{ fileId: 'pub', filename: 'report.docx', url }]),
    ];

    render(
      <ChatBoundary onError={onError}>
        <SandboxFileDownloadSync />
        <div>chat visible</div>
      </ChatBoundary>,
    );

    expect(screen.getByText('chat visible')).toBeTruthy();
    expect(screen.queryByText('chat failed')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(lookupGeneratedFileDownload(url)?.fileId).toBe('pub');
  });
});
