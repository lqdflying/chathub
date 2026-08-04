import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CsVLoader } from './csv';
import { DocxLoader } from './docx';
import { ChunkingLoader } from './index';
import { LatexLoader } from './latex';

vi.mock('./code', () => ({ CodeLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./csv', () => ({ CsVLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./docx', () => ({ DocxLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./epub', () => ({ EPubLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./latex', () => ({ LatexLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./markdown', () => ({ MarkdownLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./pdf', () => ({ PdfLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./pptx', () => ({ PPTXLoader: vi.fn().mockResolvedValue([]) }));
vi.mock('./txt', () => ({ TextLoader: vi.fn().mockResolvedValue([]) }));

describe('ChunkingLoader type routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a MIME-only DOCX to the DOCX loader', async () => {
    await new ChunkingLoader().partitionContent(
      'upload',
      new Uint8Array(),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(DocxLoader).toHaveBeenCalledOnce();
  });

  it('routes CSV MIME before the generic text loader', async () => {
    await new ChunkingLoader().partitionContent('upload', new Uint8Array(), 'text/csv');

    expect(CsVLoader).toHaveBeenCalledOnce();
  });

  it('recognizes the .latex extension', async () => {
    await new ChunkingLoader().partitionContent('paper.latex', new Uint8Array());

    expect(LatexLoader).toHaveBeenCalledOnce();
  });

  it('rejects database files even when they are labeled as plain text', async () => {
    await expect(
      new ChunkingLoader().partitionContent('knowledge.sqlite3', new Uint8Array(), 'text/plain'),
    ).rejects.toThrow('Unsupported file type [text/plain]');
  });
});
