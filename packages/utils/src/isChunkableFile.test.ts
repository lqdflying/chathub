import { describe, expect, it } from 'vitest';

import { isChunkableFile } from './isChunkableFile';

describe('isChunkableFile', () => {
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
});
