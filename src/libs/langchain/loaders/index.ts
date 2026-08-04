import { isChunkableFile } from '@lobechat/utils';
import {
  SupportedTextSplitterLanguage,
  SupportedTextSplitterLanguages,
} from 'langchain/text_splitter';

import { LANGCHAIN_SUPPORT_TEXT_LIST } from '@/libs/langchain/file';
import { LangChainLoaderType } from '@/libs/langchain/types';

import { CodeLoader } from './code';
import { CsVLoader } from './csv';
import { DocxLoader } from './docx';
import { EPubLoader } from './epub';
import { LatexLoader } from './latex';
import { MarkdownLoader } from './markdown';
import { PdfLoader } from './pdf';
import { PPTXLoader } from './pptx';
import { TextLoader } from './txt';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

class LangChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LangChainChunkingError';
  }
}

export class ChunkingLoader {
  partitionContent = async (filename: string, content: Uint8Array, fileType?: string) => {
    try {
      const fileBlob = new Blob([Buffer.from(content)]);
      const txt = this.uint8ArrayToString(content);

      const type = this.getType(filename?.toLowerCase(), fileType);

      if (!type || !isChunkableFile(filename, fileType)) {
        throw new Error(`Unsupported file type [${fileType || filename}]`);
      }

      switch (type) {
        case 'code': {
          const ext = filename.split('.').pop();
          return await CodeLoader(txt, ext!);
        }

        case 'ppt': {
          return await PPTXLoader(fileBlob);
        }

        case 'latex': {
          return await LatexLoader(txt);
        }

        case 'pdf': {
          return await PdfLoader(fileBlob);
        }

        case 'markdown': {
          return await MarkdownLoader(txt);
        }

        case 'doc': {
          return await DocxLoader(fileBlob);
        }

        case 'text': {
          return await TextLoader(txt);
        }

        case 'csv': {
          return await CsVLoader(fileBlob);
        }

        case 'epub': {
          return await EPubLoader(content);
        }

        default: {
          throw new Error(
            `Unsupported file type [${type}], please check your file is supported, or create report issue here: https://github.com/lobehub/lobe-chat/discussions/3550`,
          );
        }
      }
    } catch (e) {
      throw new LangChainError((e as Error).message);
    }
  };

  private getType = (filename: string, fileType?: string): LangChainLoaderType | undefined => {
    const normalizedType = fileType?.toLowerCase().split(';', 1)[0].trim();

    if (normalizedType === PPTX_MIME) return 'ppt';
    if (normalizedType === DOCX_MIME) return 'doc';
    if (normalizedType === 'application/pdf') return 'pdf';
    if (normalizedType === 'application/epub+zip') return 'epub';
    if (normalizedType === 'text/csv') return 'csv';
    if (normalizedType === 'text/markdown' || normalizedType === 'text/x-markdown') {
      return 'markdown';
    }
    if (normalizedType === 'application/x-tex' || normalizedType === 'text/x-tex') {
      return 'latex';
    }
    if (
      normalizedType?.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/yaml'].includes(normalizedType || '')
    ) {
      return 'text';
    }

    if (filename.endsWith('.pptx')) {
      return 'ppt';
    }

    if (filename.endsWith('.docx')) {
      return 'doc';
    }

    if (filename.endsWith('.pdf')) {
      return 'pdf';
    }

    if (filename.endsWith('.tex') || filename.endsWith('.latex')) {
      return 'latex';
    }

    if (filename.endsWith('.md') || filename.endsWith('.mdx') || filename.endsWith('.markdown')) {
      return 'markdown';
    }

    if (filename.endsWith('.csv')) {
      return 'csv';
    }

    if (filename.endsWith('.epub')) {
      return 'epub';
    }

    const ext = filename.split('.').pop();

    if (ext && SupportedTextSplitterLanguages.includes(ext as SupportedTextSplitterLanguage)) {
      return 'code';
    }

    if (ext && LANGCHAIN_SUPPORT_TEXT_LIST.includes(ext)) return 'text';
  };

  private uint8ArrayToString(uint8Array: Uint8Array) {
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
  }
}
