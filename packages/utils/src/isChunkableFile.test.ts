import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getChunkableFileExtensions,
  isChunkableFile,
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
