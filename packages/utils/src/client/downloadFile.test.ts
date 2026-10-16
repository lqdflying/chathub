import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadFile, setIosDownloadUi } from './downloadFile';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const fileResponse = (ok = true) => ({
  blob: async () => new Blob(['docx'], { type: 'application/octet-stream' }),
  ok,
  status: ok ? 200 : 401,
  statusText: ok ? 'OK' : 'Unauthorized',
});

describe('downloadFile', () => {
  const share = vi.fn();
  const canShare = vi.fn(() => true);
  const open = vi.fn();

  beforeEach(() => {
    share.mockReset();
    share.mockResolvedValue(undefined);
    canShare.mockReset();
    canShare.mockReturnValue(true);
    open.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => fileResponse()));
    vi.spyOn(window, 'open').mockImplementation(open);
    setIosDownloadUi(undefined);
  });

  afterEach(() => {
    setIosDownloadUi(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const useNavigator = (userAgent: string, standalone = false, isActive = true) => {
    vi.stubGlobal('navigator', {
      canShare,
      maxTouchPoints: 0,
      share,
      standalone,
      userActivation: { isActive },
      userAgent,
    });
  };

  it('shares a same-origin file from the installed iOS app', async () => {
    useNavigator(IPHONE_UA, true);
    const url = `${location.origin}/webapi/files/scope/id.docx`;

    await downloadFile(url, 'download_test.docx');

    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(share).toHaveBeenCalledOnce();
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file.name).toBe('download_test.docx');
    expect(open).not.toHaveBeenCalled();
  });

  it('does not open a window when the user cancels the share sheet', async () => {
    useNavigator(IPHONE_UA, true);
    share.mockRejectedValue(new DOMException('cancelled', 'AbortError'));

    await downloadFile(`${location.origin}/webapi/files/a.docx`, 'download_test.docx');

    expect(open).not.toHaveBeenCalled();
  });

  it('does not open a window when the installed app cannot fetch the file', async () => {
    useNavigator(IPHONE_UA, true);
    vi.stubGlobal('fetch', vi.fn(async () => fileResponse(false)));
    const reportError = vi.fn();
    setIosDownloadUi({ promptSave: vi.fn(), reportError });

    await downloadFile(`${location.origin}/webapi/files/a.docx`, 'download_test.docx');

    expect(open).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith('fetch_failed');
  });

  it('asks for a second tap when the gesture expires before the file arrives', async () => {
    useNavigator(IPHONE_UA, true, false);
    const promptSave = vi.fn(async () => undefined);
    setIosDownloadUi({ promptSave, reportError: vi.fn() });

    await downloadFile(`${location.origin}/webapi/files/a.docx`, 'download_test.docx');

    expect(share).not.toHaveBeenCalled();
    expect(promptSave).toHaveBeenCalledOnce();
    expect((promptSave.mock.calls[0][0] as File).name).toBe('download_test.docx');
    expect(open).not.toHaveBeenCalled();
  });

  it('omits cookies for a cross-origin file', async () => {
    useNavigator(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadFile('https://cdn.example/report.docx', 'report.docx');

    expect(fetch).toHaveBeenCalledWith(
      'https://cdn.example/report.docx',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(share).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('downloads a same-origin file with an anchor in a desktop installed app', async () => {
    useNavigator(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      true,
    );
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });

    await downloadFile(`${location.origin}/webapi/files/a.docx`, 'download_test.docx');

    expect(fetch).toHaveBeenCalledWith(
      `${location.origin}/webapi/files/a.docx`,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(share).not.toHaveBeenCalled();
    expect(names).toEqual(['download_test.docx']);
    expect(open).not.toHaveBeenCalled();
  });
});
