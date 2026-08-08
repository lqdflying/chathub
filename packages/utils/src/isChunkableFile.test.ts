import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getChunkableFileExtensions,
  isChunkableFile,
  isDocumentParseableFile,
  isMarkItDownConvertibleFile,
  isOfficePreviewFile,
  setChunkableFileCapabilities,
} from './isChunkableFile';

describe('isChunkableFile', () => {
  // The capability defaults to whatever the environment says, so pin it here
  // rather than depending on the developer's MARKITDOWN_SERVICE_URL.
  beforeEach(() => setChunkableFileCapabilities({ markitdown: false }));
  afterEach(() => setChunkableFileCapabilities({ markitdown: false }));

  it('accepts formats handled by the document loaders', () => {
    expect(isChunkableFile('guide.pdf', 'application/pdf')).toBe(true);
    expect(isChunkableFile('notes.md', 'text/markdown')).toBe(true);
    expect(isChunkableFile('readme', 'text/plain')).toBe(true);
    expect(isChunkableFile('slides.pptx')).toBe(true);
    expect(isChunkableFile('report.docx', '')).toBe(true);
    expect(isChunkableFile('paper.latex', 'application/x-tex')).toBe(true);
    expect(isChunkableFile('data', 'application/json')).toBe(true);
  });

  it('rejects images, office formats without a loader, archives, and unknown files', () => {
    expect(isChunkableFile('photo.png', 'image/png')).toBe(false);
    expect(isChunkableFile('legacy.doc', 'application/msword')).toBe(false);
    expect(isChunkableFile('legacy.doc', 'text/plain')).toBe(false);
    expect(isChunkableFile('sheet.xlsx')).toBe(false);
    expect(isChunkableFile('bundle.zip', 'application/zip')).toBe(false);
    expect(isChunkableFile('diagram.svg', 'image/svg+xml')).toBe(false);
    expect(isChunkableFile('unknown.bin', 'application/octet-stream')).toBe(false);
  });

  it('rejects database files even when their MIME type is missing or misleading', () => {
    expect(isChunkableFile('knowledge.db')).toBe(false);
    expect(isChunkableFile('knowledge.sqlite', 'application/x-sqlite3')).toBe(false);
    expect(isChunkableFile('knowledge.sqlite3', 'text/plain')).toBe(false);
  });

  describe('with a MarkItDown sidecar configured', () => {
    beforeEach(() => setChunkableFileCapabilities({ markitdown: true }));

    it('accepts the formats MarkItDown converts but the loaders cannot read', () => {
      expect(
        isChunkableFile(
          'budget.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toBe(true);
      expect(isChunkableFile('legacy.xls', 'application/vnd.ms-excel')).toBe(true);
      expect(isChunkableFile('bundle.zip', 'application/zip')).toBe(true);
      expect(isChunkableFile('thread.msg', 'application/vnd.ms-outlook')).toBe(true);
      expect(isChunkableFile('analysis.ipynb')).toBe(true);
      expect(isChunkableFile('scan.png', 'image/png')).toBe(true);
      expect(isChunkableFile('meeting.mp3', 'audio/mpeg')).toBe(true);
      expect(isChunkableFile('feed.rss', 'application/rss+xml')).toBe(true);
    });

    it('still rejects legacy Word and database files, which MarkItDown cannot convert either', () => {
      expect(isChunkableFile('legacy.doc', 'application/msword')).toBe(false);
      expect(isChunkableFile('macro.docm')).toBe(false);
      expect(isChunkableFile('knowledge.sqlite', 'application/x-sqlite3')).toBe(false);
      expect(isChunkableFile('diagram.svg', 'image/svg+xml')).toBe(false);
      expect(isChunkableFile('clip.mkv', 'video/x-matroska')).toBe(false);
    });

    it('keeps accepting everything the loaders already handled', () => {
      expect(isChunkableFile('guide.pdf', 'application/pdf')).toBe(true);
      expect(isChunkableFile('notes.md', 'text/markdown')).toBe(true);
      expect(isChunkableFile('report.docx', '')).toBe(true);
    });
  });
});

describe('isDocumentParseableFile', () => {
  afterEach(() => setChunkableFileCapabilities({ markitdown: false }));

  it('accepts only formats handled by the synchronous document loaders', () => {
    expect(isDocumentParseableFile('notes.txt', 'text/plain')).toBe(true);
    expect(isDocumentParseableFile('readme.md', 'text/markdown')).toBe(true);
    expect(isDocumentParseableFile('data.json', 'application/json')).toBe(true);
    expect(isDocumentParseableFile('table.csv', 'text/csv')).toBe(true);
    expect(isDocumentParseableFile('guide.pdf', 'application/pdf')).toBe(true);
    expect(isDocumentParseableFile('legacy.doc', 'application/msword')).toBe(true);
    expect(isDocumentParseableFile('report.docx')).toBe(true);
    expect(
      isDocumentParseableFile(
        'budget.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
    expect(isDocumentParseableFile('legacy.xls', 'application/vnd.ms-excel')).toBe(true);
    expect(isDocumentParseableFile('slides.pptx')).toBe(true);
    expect(isDocumentParseableFile('source.custom', 'text/x-custom')).toBe(true);
  });

  it('rejects binary and unsupported formats without a MarkItDown sidecar', () => {
    setChunkableFileCapabilities({ markitdown: false });

    expect(isDocumentParseableFile('scan.png', 'image/png')).toBe(false);
    expect(isDocumentParseableFile('photo.jpg', 'image/jpeg')).toBe(false);
    expect(isDocumentParseableFile('photo.jpeg', 'image/jpeg')).toBe(false);
    expect(isDocumentParseableFile('bundle.zip', 'application/zip')).toBe(false);
    expect(isDocumentParseableFile('thread.msg', 'application/vnd.ms-outlook')).toBe(false);
    expect(isDocumentParseableFile('meeting.mp3', 'audio/mpeg')).toBe(false);
    expect(isDocumentParseableFile('macro.docm', 'application/msword')).toBe(false);
    expect(isDocumentParseableFile('book.epub', 'application/epub+zip')).toBe(false);
  });

  it('stays limited to built-in loaders when a MarkItDown sidecar is configured', () => {
    setChunkableFileCapabilities({ markitdown: true });

    expect(isDocumentParseableFile('scan.png', 'image/png')).toBe(false);
    expect(isDocumentParseableFile('bundle.zip', 'application/zip')).toBe(false);
    expect(isDocumentParseableFile('thread.msg', 'application/vnd.ms-outlook')).toBe(false);
    expect(isDocumentParseableFile('meeting.mp3', 'audio/mpeg')).toBe(false);
    expect(isDocumentParseableFile('budget.xlsx')).toBe(true);
    expect(isDocumentParseableFile('legacy.doc')).toBe(true);
    expect(isDocumentParseableFile('book.epub', 'application/epub+zip')).toBe(false);
    expect(isDocumentParseableFile('notes.txt', 'text/plain')).toBe(true);
    expect(isDocumentParseableFile('guide.pdf', 'application/pdf')).toBe(true);
  });
});

describe('getChunkableFileExtensions', () => {
  afterEach(() => setChunkableFileCapabilities({ markitdown: false }));

  it('offers only the built-in loader formats by default', () => {
    setChunkableFileCapabilities({ markitdown: false });

    expect(getChunkableFileExtensions()).toContain('.pdf');
    expect(getChunkableFileExtensions()).not.toContain('.xlsx');
  });

  it('offers the MarkItDown formats once a sidecar is configured', () => {
    setChunkableFileCapabilities({ markitdown: true });

    const extensions = getChunkableFileExtensions();

    expect(extensions).toContain('.pdf');
    expect(extensions).toContain('.xlsx');
    expect(extensions).toContain('.msg');
    expect(extensions).not.toContain('.doc');
  });
});

describe('isOfficePreviewFile', () => {
  it('detects Office/MSDoc types by extension', () => {
    expect(isOfficePreviewFile('a.docx')).toBe(true);
    expect(isOfficePreviewFile('a.xlsx')).toBe(true);
    expect(isOfficePreviewFile('a.pptx')).toBe(true);
    expect(isOfficePreviewFile('A.DOC')).toBe(true);
  });

  it('returns false for locally-previewable types', () => {
    expect(isOfficePreviewFile('a.pdf')).toBe(false);
    expect(isOfficePreviewFile('a.png')).toBe(false);
    expect(isOfficePreviewFile('a.md')).toBe(false);
  });
});

describe('isMarkItDownConvertibleFile', () => {
  afterEach(() => setChunkableFileCapabilities({ markitdown: false }));

  it('returns false when the sidecar is not configured', () => {
    setChunkableFileCapabilities({ markitdown: false });

    expect(isMarkItDownConvertibleFile('a.docx')).toBe(false);
    expect(isMarkItDownConvertibleFile('a.xlsx')).toBe(false);
  });

  it('accepts MarkItDown-only extended types when configured', () => {
    setChunkableFileCapabilities({ markitdown: true });

    expect(isMarkItDownConvertibleFile('a.xlsx')).toBe(true);
    expect(isMarkItDownConvertibleFile('a.png')).toBe(true);
    expect(isMarkItDownConvertibleFile('a.mp3')).toBe(true);
  });

  it('accepts standard chunkable types MarkItDown also reads', () => {
    setChunkableFileCapabilities({ markitdown: true });

    expect(isMarkItDownConvertibleFile('a.docx')).toBe(true);
    expect(isMarkItDownConvertibleFile('a.pdf')).toBe(true);
    expect(isMarkItDownConvertibleFile('a.md')).toBe(true);
  });

  it('rejects hard-unsupported types even when configured', () => {
    setChunkableFileCapabilities({ markitdown: true });

    expect(isMarkItDownConvertibleFile('a.doc')).toBe(false);
    expect(isMarkItDownConvertibleFile('a.db')).toBe(false);
    expect(isMarkItDownConvertibleFile('a.sqlite')).toBe(false);
  });
});
