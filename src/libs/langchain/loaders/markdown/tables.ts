import { Root, Table } from 'mdast';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';

export interface MarkdownBlock {
  content: string;
  type: 'table' | 'text';
}

interface CodeFenceState {
  character: '`' | '~';
  length: number;
}

const markdownParser = remark().use(remarkGfm);

const getNextCodeFenceState = (
  line: string,
  currentState?: CodeFenceState,
): CodeFenceState | undefined => {
  if (currentState) {
    const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
    const delimiter = closingFence?.[1];

    if (delimiter?.[0] === currentState.character && delimiter.length >= currentState.length) {
      return undefined;
    }

    return currentState;
  }

  const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const delimiter = openingFence?.[1];
  const info = openingFence?.[2] ?? '';
  if (!delimiter || (delimiter[0] === '`' && info.includes('`'))) return undefined;

  return {
    character: delimiter[0] as CodeFenceState['character'],
    length: delimiter.length,
  };
};

const isTableSeparatorRow = (line: string): boolean => {
  const trimmedLine = line.trim();
  if (!trimmedLine.includes('|')) return false;

  const cells = trimmedLine
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const parseTable = (markdown: string): Table | undefined => {
  const tree = markdownParser.parse(markdown) as Root;
  if (tree.children.length !== 1) return undefined;

  const [node] = tree.children;
  return node.type === 'table' ? (node as Table) : undefined;
};

const splitMergedTableSeparator = (
  line: string,
): { header: string; separator: string } | undefined => {
  if (isTableSeparatorRow(line)) return undefined;

  for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
    if (line[characterIndex] !== '|') continue;

    const separator = line.slice(characterIndex).trim();
    const header = line.slice(0, characterIndex).trimEnd();
    if (!header.endsWith('|') || !isTableSeparatorRow(separator)) continue;

    const table = parseTable(`${header}\n${separator}`);
    const headerColumnCount = table?.children[0]?.children.length;
    if (headerColumnCount && headerColumnCount === table.align?.length) {
      return { header, separator };
    }
  }
};

/**
 * Ensures table separators have their own line. This is deliberately
 * idempotent because both the MarkItDown path and the generic Markdown loader
 * can call it.
 */
export const normalizeMarkdownTables = (markdown: string): string => {
  const sourceLines = markdown.replaceAll(/\r\n?/g, '\n').split('\n');
  const normalizedLines: string[] = [];
  let codeFenceState: CodeFenceState | undefined;

  for (const currentLine of sourceLines) {
    const nextCodeFenceState = getNextCodeFenceState(currentLine, codeFenceState);
    const isFenceBoundary = nextCodeFenceState !== codeFenceState;

    if (codeFenceState || isFenceBoundary) {
      normalizedLines.push(currentLine);
      codeFenceState = nextCodeFenceState;
      continue;
    }

    const mergedTableSeparator = splitMergedTableSeparator(currentLine);
    if (mergedTableSeparator) {
      normalizedLines.push(mergedTableSeparator.header, mergedTableSeparator.separator);
    } else {
      normalizedLines.push(currentLine);
    }
  }

  return normalizedLines.join('\n');
};

export const splitMarkdownIntoBlocks = (markdown: string): MarkdownBlock[] => {
  const tree = markdownParser.parse(markdown) as Root;
  const blocks: MarkdownBlock[] = [];
  let sourceOffset = 0;

  for (const node of tree.children) {
    if (node.type !== 'table') continue;

    const tableStart = node.position?.start.offset;
    const tableEnd = node.position?.end.offset;
    if (tableStart === undefined || tableEnd === undefined) continue;

    const textContent = markdown.slice(sourceOffset, tableStart).trim();
    if (textContent) {
      blocks.push({ content: textContent, type: 'text' });
    }

    blocks.push({
      content: markdown.slice(tableStart, tableEnd),
      type: 'table',
    });
    sourceOffset = tableEnd;
  }

  const trailingText = markdown.slice(sourceOffset).trim();
  if (trailingText) {
    blocks.push({ content: trailingText, type: 'text' });
  }

  return blocks;
};
