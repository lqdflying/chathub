import { Document } from 'langchain/document';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

import { loaderConfig } from '../config';
import { normalizeMarkdownTables, splitMarkdownIntoBlocks } from './tables';

export const MarkdownLoader = async (text: string) => {
  const splitter = new MarkdownTextSplitter(loaderConfig);
  const blocks = splitMarkdownIntoBlocks(normalizeMarkdownTables(text));
  const documents = [];

  for (const block of blocks) {
    if (block.type === 'table') {
      documents.push(new Document({ pageContent: block.content }));
      continue;
    }

    documents.push(...(await splitter.createDocuments([block.content])));
  }

  return documents;
};
