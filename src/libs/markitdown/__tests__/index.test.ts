import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkItDown, MarkItDownError, isMarkItDownEnabled } from '../index';

vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: {
    get MARKITDOWN_API_KEY() {
      return process.env.MARKITDOWN_API_KEY;
    },
    get MARKITDOWN_MAX_FILE_SIZE() {
      return Number(process.env.MARKITDOWN_MAX_FILE_SIZE ?? 100 * 1024 * 1024);
    },
    get MARKITDOWN_SERVICE_URL() {
      return process.env.MARKITDOWN_SERVICE_URL;
    },
    get MARKITDOWN_TIMEOUT() {
      return Number(process.env.MARKITDOWN_TIMEOUT ?? 180_000);
    },
  },
}));

const content = new TextEncoder().encode('binary-ish payload');

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

describe('MarkItDown client', () => {
  beforeEach(() => {
    process.env.MARKITDOWN_SERVICE_URL = 'http://markitdown:5000';
    delete process.env.MARKITDOWN_API_KEY;
    delete process.env.MARKITDOWN_MAX_FILE_SIZE;
  });

  afterEach(() => {
    delete process.env.MARKITDOWN_SERVICE_URL;
    delete process.env.MARKITDOWN_API_KEY;
    delete process.env.MARKITDOWN_MAX_FILE_SIZE;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('isMarkItDownEnabled', () => {
    it('is driven by the service URL', () => {
      expect(isMarkItDownEnabled()).toBe(true);

      delete process.env.MARKITDOWN_SERVICE_URL;
      expect(isMarkItDownEnabled()).toBe(false);
    });
  });

  it('posts the document as multipart form data and returns the markdown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ markdown: '# Sheet1\n\n| a | b |\n', title: 'Budget' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new MarkItDown().convert({
      content,
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'budget.xlsx',
    });

    expect(result).toEqual({ markdown: '# Sheet1\n\n| a | b |', title: 'Budget' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://markitdown:5000/convert');
    expect(init.method).toBe('POST');

    const form = init.body as FormData;
    expect(form.get('filename')).toBe('budget.xlsx');
    expect(form.get('mime_type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(form.get('file')).toBeInstanceOf(Blob);
    // The bytes must survive: a mangled upload converts to plausible nonsense.
    expect(await (form.get('file') as Blob).text()).toBe('binary-ish payload');
  });

  it('strips a trailing slash from the configured URL', async () => {
    process.env.MARKITDOWN_SERVICE_URL = 'http://markitdown:5000/';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ markdown: 'hi' }));
    vi.stubGlobal('fetch', fetchMock);

    await new MarkItDown().convert({ content, filename: 'a.pdf' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://markitdown:5000/convert');
  });

  it('sends a bearer token only when one is configured', async () => {
    // A Response body can only be read once, so build a fresh one per call.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ markdown: 'hi' }));
    vi.stubGlobal('fetch', fetchMock);

    await new MarkItDown().convert({ content, filename: 'a.pdf' });
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();

    process.env.MARKITDOWN_API_KEY = 'sekret';
    await new MarkItDown().convert({ content, filename: 'a.pdf' });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer sekret' });
  });

  it('reports NotConfigured without attempting a request', async () => {
    delete process.env.MARKITDOWN_SERVICE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new MarkItDown().convert({ content, filename: 'a.pdf' })).rejects.toMatchObject({
      code: 'NotConfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses files above the size cap before uploading them', async () => {
    process.env.MARKITDOWN_MAX_FILE_SIZE = '4';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new MarkItDown().convert({ content, filename: 'big.pdf' })).rejects.toMatchObject({
      code: 'FileTooLarge',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 415 to UnsupportedFormat and other failures to ConversionFailed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('no converter', { status: 415 })),
    );
    await expect(new MarkItDown().convert({ content, filename: 'a.xyz' })).rejects.toMatchObject({
      code: 'UnsupportedFormat',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    await expect(new MarkItDown().convert({ content, filename: 'a.pdf' })).rejects.toMatchObject({
      code: 'ConversionFailed',
    });
  });

  it('maps a network failure to ServiceUnavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const error = await new MarkItDown()
      .convert({ content, filename: 'a.pdf' })
      .catch((e) => e as MarkItDownError);

    expect(error).toBeInstanceOf(MarkItDownError);
    expect(error.code).toBe('ServiceUnavailable');
    expect(error.message).toContain('ECONNREFUSED');
  });

  it('treats a blank conversion as EmptyResult so the caller can fall back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ markdown: '   \n  ' })));

    await expect(new MarkItDown().convert({ content, filename: 'scan.png' })).rejects.toMatchObject(
      {
        code: 'EmptyResult',
      },
    );
  });
});
