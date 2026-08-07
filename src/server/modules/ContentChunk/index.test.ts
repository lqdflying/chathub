import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
  isMarkItDownEnabled: vi.fn(),
  knowledgeEnv: { FILE_TYPE_CHUNKING_RULES: '' as string | undefined },
  partitionContent: vi.fn(),
  partitionMarkdown: vi.fn(),
}));

vi.mock('@/envs/knowledge', () => ({ knowledgeEnv: mocks.knowledgeEnv }));

vi.mock('@/libs/markitdown', () => ({
  MarkItDown: class {
    convert = mocks.convert;
  },
  isMarkItDownEnabled: mocks.isMarkItDownEnabled,
}));

vi.mock('@/libs/langchain', () => ({
  ChunkingLoader: class {
    partitionContent = mocks.partitionContent;
    partitionMarkdown = mocks.partitionMarkdown;
  },
}));

vi.mock('@/libs/unstructured', () => ({
  ChunkingStrategy: { ByPage: 'by_page' },
  Unstructured: class {
    partition = vi.fn();
  },
}));

const { ContentChunk } = await import('./index');

const xlsx = {
  content: new Uint8Array([1, 2, 3]),
  fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  filename: 'budget.xlsx',
};

describe('ContentChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.knowledgeEnv.FILE_TYPE_CHUNKING_RULES = '';
    mocks.isMarkItDownEnabled.mockReturnValue(true);
    mocks.partitionMarkdown.mockResolvedValue([
      { metadata: { loc: { lines: { from: 1, to: 3 } } }, pageContent: '## Sheet1\n| a | b |' },
    ]);
    mocks.partitionContent.mockResolvedValue([{ metadata: {}, pageContent: 'plain text' }]);
  });

  it('converts to Markdown then splits it, when a sidecar is configured', async () => {
    mocks.convert.mockResolvedValue({ markdown: '## Sheet1\n| a | b |', title: 'Budget' });

    const result = await new ContentChunk().chunkContent(xlsx);

    expect(mocks.convert).toHaveBeenCalledWith({
      content: xlsx.content,
      fileType: xlsx.fileType,
      filename: 'budget.xlsx',
    });
    // The converted Markdown — not the raw bytes — is what gets split.
    expect(mocks.partitionMarkdown).toHaveBeenCalledWith('## Sheet1\n| a | b |');
    expect(mocks.partitionContent).not.toHaveBeenCalled();

    expect(result.chunks).toEqual([
      {
        id: undefined,
        index: 0,
        metadata: {
          converted_by: 'markitdown',
          loc: { lines: { from: 1, to: 3 } },
          source_file_type: xlsx.fileType,
          source_title: 'Budget',
        },
        text: '## Sheet1\n| a | b |',
        type: 'MarkItDownElement',
      },
    ]);
  });

  it('leaves the LangChain path alone when no sidecar is configured', async () => {
    mocks.isMarkItDownEnabled.mockReturnValue(false);

    const result = await new ContentChunk().chunkContent(xlsx);

    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.partitionContent).toHaveBeenCalledWith('budget.xlsx', xlsx.content, xlsx.fileType);
    expect(result.chunks[0].type).toBe('LangChainElement');
  });

  it('falls back to LangChain when conversion fails', async () => {
    mocks.convert.mockRejectedValue(new Error('service unreachable'));

    const result = await new ContentChunk().chunkContent({ ...xlsx, filename: 'notes.md' });

    expect(mocks.partitionContent).toHaveBeenCalled();
    expect(result.chunks[0].type).toBe('LangChainElement');
  });

  it('surfaces the conversion failure when the fallback also fails', async () => {
    mocks.convert.mockRejectedValue(new Error('MarkItDown service is unreachable'));
    mocks.partitionContent.mockRejectedValue(new Error('Unsupported file type [xlsx]'));

    // Without this, a down sidecar looks like an unsupported-format problem.
    await expect(new ContentChunk().chunkContent(xlsx)).rejects.toThrow(
      /Unsupported file type \[xlsx\].*markitdown: MarkItDown service is unreachable/s,
    );
  });

  it('lets a FILE_TYPE_CHUNKING_RULES extension rule opt a format out', async () => {
    // xlsx's MIME subtype is unusable as a rule key, so the extension has to work.
    mocks.knowledgeEnv.FILE_TYPE_CHUNKING_RULES = 'xlsx=default';
    mocks.convert.mockResolvedValue({ markdown: '## Sheet1' });

    const result = await new ContentChunk().chunkContent(xlsx);

    expect(mocks.convert).not.toHaveBeenCalled();
    expect(result.chunks[0].type).toBe('LangChainElement');
  });

  it('forces MarkItDown when service=markitdown even when a rule would bypass it', async () => {
    // A rule that would normally route xlsx to LangChain is overridden by the
    // explicit forced parser — the per-file MarkItDown re-parse must win.
    mocks.knowledgeEnv.FILE_TYPE_CHUNKING_RULES = 'xlsx=default';
    mocks.convert.mockResolvedValue({ markdown: '## Sheet1\n| a | b |', title: 'Budget' });

    const result = await new ContentChunk().chunkContent({ ...xlsx, service: 'markitdown' });

    expect(mocks.convert).toHaveBeenCalledWith({
      content: xlsx.content,
      fileType: xlsx.fileType,
      filename: 'budget.xlsx',
    });
    expect(result.chunks[0].type).toBe('MarkItDownElement');
    expect(result.chunks[0].metadata).toMatchObject({ converted_by: 'markitdown' });
  });

  it('falls back to LangChain when a forced MarkItDown conversion fails', async () => {
    // The forced chain is ['markitdown','default'] — a sidecar outage must never
    // hard-error, it degrades to LangChain (the documented contract).
    mocks.convert.mockRejectedValue(new Error('service unreachable'));

    const result = await new ContentChunk().chunkContent({ ...xlsx, service: 'markitdown' });

    expect(mocks.convert).toHaveBeenCalled();
    expect(mocks.partitionContent).toHaveBeenCalled();
    expect(result.chunks[0].type).toBe('LangChainElement');
  });

  it('still matches rules on the MIME subtype, as it always has', async () => {
    mocks.knowledgeEnv.FILE_TYPE_CHUNKING_RULES = 'pdf=markitdown';
    mocks.convert.mockResolvedValue({ markdown: '# Report' });

    const result = await new ContentChunk().chunkContent({
      content: new Uint8Array([4]),
      fileType: 'application/pdf',
      filename: 'report-without-extension',
    });

    expect(mocks.convert).toHaveBeenCalled();
    expect(result.chunks[0].type).toBe('MarkItDownElement');
  });
});
