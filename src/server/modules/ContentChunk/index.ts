import { Strategy } from 'unstructured-client/sdk/models/shared';

import type { NewChunkItem, NewUnstructuredChunkItem } from '@/database/schemas';
import { knowledgeEnv } from '@/envs/knowledge';
import { ChunkingLoader } from '@/libs/langchain';
import { MarkItDown, isMarkItDownEnabled } from '@/libs/markitdown';
import { ChunkingStrategy, Unstructured } from '@/libs/unstructured';

import { ChunkingRuleParser } from './rules';
import type { ChunkingService } from './rules';

export interface ChunkContentParams {
  content: Uint8Array;
  fileType: string;
  filename: string;
  mode?: 'fast' | 'hi-res';
  /**
   * Force a specific converter first, bypassing the per-type rules. Currently
   * only `'markitdown'` is supported (used by the per-file "re-parse with
   * MarkItDown" action). Falls back to the default LangChain chunker on
   * failure so a sidecar outage never hard-errors.
   */
  service?: 'markitdown';
}

interface ChunkResult {
  chunks: NewChunkItem[];
  unstructuredChunks?: NewUnstructuredChunkItem[];
}

export class ContentChunk {
  private unstructuredClient: Unstructured;
  private markitdownClient: MarkItDown;
  private langchainClient: ChunkingLoader;
  private chunkingRules: Record<string, ChunkingService[]>;

  constructor() {
    this.unstructuredClient = new Unstructured();
    this.markitdownClient = new MarkItDown();
    this.langchainClient = new ChunkingLoader();
    this.chunkingRules = ChunkingRuleParser.parse(knowledgeEnv.FILE_TYPE_CHUNKING_RULES || '');
  }

  private getChunkingServices(fileType: string, filename?: string): ChunkingService[] {
    // Rules have always been keyed on the MIME subtype, which works for simple
    // types like `application/pdf` but not for OOXML: xlsx's subtype is
    // `vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Fall back to the
    // filename extension so `xlsx=markitdown` means what it looks like.
    const subtype = fileType.split('/').pop()?.toLowerCase() || '';
    if (this.chunkingRules[subtype]) return this.chunkingRules[subtype];

    const extension = filename?.toLowerCase().split('.').pop() || '';
    if (extension && this.chunkingRules[extension]) return this.chunkingRules[extension];

    return this.defaultChunkingServices();
  }

  /**
   * With a MarkItDown sidecar configured it becomes the preferred converter for
   * every format — that is the point of the integration: everything reaches the
   * embedder as Markdown. LangChain stays as the fallback so a sidecar that is
   * down or that rejects a format still degrades to the previous behaviour.
   */
  private defaultChunkingServices(): ChunkingService[] {
    return isMarkItDownEnabled() ? ['markitdown', 'default'] : ['default'];
  }

  async chunkContent(params: ChunkContentParams): Promise<ChunkResult> {
    // A forced per-file converter overrides the per-type rules but still falls
    // back to LangChain so a sidecar failure never hard-errors.
    const services = params.service
      ? ([params.service, 'default'] as ChunkingService[])
      : this.getChunkingServices(params.fileType, params.filename);
    const earlierFailures: string[] = [];

    for (const service of services) {
      try {
        switch (service) {
          case 'unstructured': {
            if (this.canUseUnstructured()) {
              return await this.chunkByUnstructured(params.filename, params.content);
            }
            break;
          }

          case 'markitdown': {
            if (isMarkItDownEnabled()) {
              return await this.chunkByMarkItDown(params.filename, params.content, params.fileType);
            }
            break;
          }

          case 'doc2x': {
            // Future implementation
            break;
          }

          default: {
            return await this.chunkByLangChain(params.filename, params.content, params.fileType);
          }
        }
      } catch (error) {
        // If this is the last service, throw the error. A fallback chain hides
        // the interesting failure otherwise: when MarkItDown is down, LangChain
        // reports "unsupported file type" for a format only MarkItDown handles,
        // so carry the earlier reasons into the error that surfaces.
        if (service === services.at(-1)) {
          if (earlierFailures.length > 0 && error instanceof Error) {
            error.message = `${error.message} (after ${earlierFailures.join('; ')})`;
          }
          throw error;
        }
        // Otherwise continue to next service
        earlierFailures.push(`${service}: ${(error as Error)?.message ?? error}`);
        console.error('Chunking failed with service:', service, error);
      }
    }

    // Fallback to langchain if no service succeeded
    return await this.chunkByLangChain(params.filename, params.content, params.fileType);
  }

  private canUseUnstructured(): boolean {
    return !!(knowledgeEnv.UNSTRUCTURED_API_KEY && knowledgeEnv.UNSTRUCTURED_SERVER_URL);
  }

  private chunkByUnstructured = async (
    filename: string,
    content: Uint8Array,
  ): Promise<ChunkResult> => {
    const result = await this.unstructuredClient.partition({
      chunkingStrategy: ChunkingStrategy.ByPage,
      fileContent: content,
      filename,
      strategy: Strategy.Auto,
    });

    // after finish partition, we need to filter out some elements
    const documents = result.compositeElements
      .filter((e) => !new Set(['PageNumber', 'Footer']).has(e.type))
      .map((item, index): NewChunkItem => {
        const {
          text_as_html,
          page_number,
          page_name,
          image_mime_type,
          image_base64,
          parent_id,
          languages,
          coordinates,
        } = item.metadata;

        return {
          id: item.element_id,
          index,
          metadata: {
            coordinates,
            image_base64,
            image_mime_type,
            languages,
            page_name,
            page_number,
            parent_id,
            text_as_html,
          },
          text: item.text,
          type: item.type,
        };
      });

    const chunks = result.originElements
      .filter((e) => !new Set(['PageNumber', 'Footer']).has(e.type))
      .map((item, index): NewUnstructuredChunkItem => {
        const {
          text_as_html,
          page_number,
          page_name,
          image_mime_type,
          image_base64,
          parent_id,
          languages,
          coordinates,
        } = item.metadata;

        return {
          compositeId: item.compositeId,
          id: item.element_id,
          index,
          metadata: {
            coordinates,
            image_base64,
            image_mime_type,
            languages,
            page_name,
            page_number,
            text_as_html,
          },
          parentId: parent_id,
          text: item.text,
          type: item.type,
        };
      });

    return { chunks: documents, unstructuredChunks: chunks };
  };

  /**
   * Convert the document to Markdown out of process, then split the Markdown
   * with the markdown-aware splitter so headings and tables survive chunking.
   */
  private chunkByMarkItDown = async (
    filename: string,
    content: Uint8Array,
    fileType?: string,
  ): Promise<ChunkResult> => {
    const { markdown, title } = await this.markitdownClient.convert({
      content,
      fileType,
      filename,
    });

    const res = await this.langchainClient.partitionMarkdown(markdown);

    const chunks = res.map((item, index): NewChunkItem => ({
      id: item.id,
      index,
      metadata: {
        ...item.metadata,
        converted_by: 'markitdown',
        source_file_type: fileType,
        source_title: title,
      },
      text: item.pageContent,
      type: 'MarkItDownElement',
    }));

    return { chunks };
  };

  private chunkByLangChain = async (
    filename: string,
    content: Uint8Array,
    fileType: string,
  ): Promise<ChunkResult> => {
    const res = await this.langchainClient.partitionContent(filename, content, fileType);

    const documents = res.map((item, index) => ({
      id: item.id,
      index,
      metadata: item.metadata,
      text: item.pageContent,
      type: 'LangChainElement',
    }));

    return { chunks: documents };
  };
}
