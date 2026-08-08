import { Document } from 'langchain/document';
import { MarkdownTextSplitter } from 'langchain/text_splitter';
import type { Root, Table, TableCell, TableRow } from 'mdast';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';

import { loaderConfig } from '../config';
import { normalizeMarkdownTables, splitMarkdownIntoBlocks } from './tables';

const markdownProcessor = remark().use(remarkGfm);

const parseTableNode = (markdown: string): Table | undefined => {
  const tree = markdownProcessor.parse(markdown) as Root;
  if (tree.children.length !== 1) return undefined;

  const [node] = tree.children;
  return node.type === 'table' ? (node as Table) : undefined;
};

const serializeTableCell = (cell: TableCell): string => {
  const root: Root = {
    children: [
      {
        children: cell.children,
        type: 'paragraph',
      },
    ],
    type: 'root',
  };

  return markdownProcessor.stringify(root).trim();
};

const getTableCellSource = (cell: TableCell, tableContent: string): string => {
  const firstChild = cell.children[0];
  const lastChild = cell.children.at(-1);
  const startOffset = firstChild?.position?.start.offset;
  const endOffset = lastChild?.position?.end.offset;

  if (startOffset === undefined || endOffset === undefined) {
    return serializeTableCell(cell);
  }

  return tableContent.slice(startOffset, endOffset);
};

const splitWithoutBreakingUnicode = (content: string, maximumLength: number): string[] => {
  if (!content) return [''];

  const segments: string[] = [];
  let currentSegment = '';

  for (const character of content) {
    if (currentSegment && currentSegment.length + character.length > maximumLength) {
      segments.push(currentSegment);
      currentSegment = '';
    }

    currentSegment += character;
  }

  if (currentSegment) segments.push(currentSegment);
  return segments;
};

const truncateContextLabel = (label: string): string => {
  const singleLineLabel = label.replaceAll(/\s+/g, ' ').trim();
  const maximumLabelLength = 80;

  return singleLineLabel.length > maximumLabelLength
    ? `${singleLineLabel.slice(0, maximumLabelLength - 1)}…`
    : singleLineLabel;
};

const createContinuationHeading = ({
  columnCount,
  columnIndex,
  columnLabel,
  rowIndex,
}: {
  columnCount: number;
  columnIndex: number;
  columnLabel?: string;
  rowIndex: number;
}): string => {
  const location =
    rowIndex === 0
      ? `Table header, column ${columnIndex + 1}/${columnCount}`
      : `Table row ${rowIndex}, column ${columnIndex + 1}/${columnCount}`;
  const label = columnLabel ? ` (${truncateContextLabel(columnLabel)})` : '';

  return `**${location}${label}**`;
};

const splitRowIntoContinuations = ({
  headerLabels,
  maximumLength,
  row,
  rowIndex,
  tableContent,
  tablePrefix,
}: {
  headerLabels: string[];
  maximumLength: number;
  row: TableRow;
  rowIndex: number;
  tableContent: string;
  tablePrefix?: string;
}): string[] => {
  const continuationDocuments: string[] = [];

  for (const [columnIndex, cell] of row.children.entries()) {
    const heading = createContinuationHeading({
      columnCount: row.children.length,
      columnIndex,
      columnLabel: rowIndex === 0 ? undefined : headerLabels[columnIndex],
      rowIndex,
    });
    const headingWithTable =
      tablePrefix && tablePrefix.length + heading.length + 4 < maximumLength
        ? `${tablePrefix}\n\n${heading}`
        : heading;
    const contentPrefix = `${headingWithTable}\n\n`;
    const maximumContentLength = maximumLength - contentPrefix.length;
    const cellMarkdown = getTableCellSource(cell, tableContent);
    const cellContent = cellMarkdown || '_Empty cell_';

    for (const segment of splitWithoutBreakingUnicode(cellContent, maximumContentLength)) {
      continuationDocuments.push(`${contentPrefix}${segment}`);
    }
  }

  return continuationDocuments;
};

const splitTableDocument = (content: string, maximumLength: number): string[] | undefined => {
  if (content.length <= maximumLength) return [content];

  const table = parseTableNode(content);
  const tableLines = content.split('\n');
  if (!table || tableLines.length < 2 || table.children.length !== tableLines.length - 1) {
    return undefined;
  }

  const [headerLine, separatorLine, ...bodyLines] = tableLines;
  const tablePrefix = `${headerLine}\n${separatorLine}`;
  const headerLabels = table.children[0].children.map(serializeTableCell);

  if (tablePrefix.length > maximumLength) {
    return table.children.flatMap((row, rowIndex) =>
      splitRowIntoContinuations({
        headerLabels,
        maximumLength,
        row,
        rowIndex,
        tableContent: content,
      }),
    );
  }

  const documents: string[] = [];
  let pendingRows: string[] = [];

  const appendPendingRows = () => {
    if (pendingRows.length === 0) return;

    documents.push([tablePrefix, ...pendingRows].join('\n'));
    pendingRows = [];
  };

  for (const [bodyRowIndex, bodyLine] of bodyLines.entries()) {
    const candidateDocument = [tablePrefix, ...pendingRows, bodyLine].join('\n');
    if (candidateDocument.length <= maximumLength) {
      pendingRows.push(bodyLine);
      continue;
    }

    appendPendingRows();

    const singleRowDocument = `${tablePrefix}\n${bodyLine}`;
    if (singleRowDocument.length <= maximumLength) {
      pendingRows.push(bodyLine);
      continue;
    }

    documents.push(
      ...splitRowIntoContinuations({
        headerLabels,
        maximumLength,
        row: table.children[bodyRowIndex + 1],
        rowIndex: bodyRowIndex + 1,
        tableContent: content,
        tablePrefix,
      }),
    );
  }

  appendPendingRows();
  return documents;
};

export const MarkdownLoader = async (text: string) => {
  const splitter = new MarkdownTextSplitter(loaderConfig);
  const blocks = splitMarkdownIntoBlocks(normalizeMarkdownTables(text));
  const documents = [];

  for (const block of blocks) {
    if (block.type === 'table') {
      const tableDocuments = splitTableDocument(block.content, loaderConfig.chunkSize);

      if (tableDocuments) {
        documents.push(...tableDocuments.map((pageContent) => new Document({ pageContent })));
      } else {
        documents.push(...(await splitter.createDocuments([block.content])));
      }

      continue;
    }

    documents.push(...(await splitter.createDocuments([block.content])));
  }

  return documents;
};
