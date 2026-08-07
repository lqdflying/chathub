export interface MarkdownBlock {
  content: string;
  type: 'table' | 'text';
}

const isCodeFence = (line: string): boolean => /^\s*(`{3,}|~{3,})/.test(line);

const isTableRow = (line: string): boolean => {
  const trimmedLine = line.trim();
  return trimmedLine.length > 0 && trimmedLine.includes('|');
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

const splitMergedTableSeparator = (
  line: string,
): { header: string; separator: string } | undefined => {
  for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
    if (line[characterIndex] !== '|') continue;

    const separator = line.slice(characterIndex).trim();
    const header = line.slice(0, characterIndex).trimEnd();

    if (isTableRow(header) && isTableSeparatorRow(separator)) {
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
  let insideCodeFence = false;

  const appendLine = (line: string) => {
    if (line === '' && normalizedLines.at(-1) === '') return;
    normalizedLines.push(line);
  };

  for (let lineIndex = 0; lineIndex < sourceLines.length;) {
    const currentLine = sourceLines[lineIndex];

    if (isCodeFence(currentLine)) {
      insideCodeFence = !insideCodeFence;
      appendLine(currentLine);
      lineIndex += 1;
      continue;
    }

    if (!insideCodeFence) {
      const mergedTableSeparator = splitMergedTableSeparator(currentLine);
      const tableHeader = mergedTableSeparator?.header ?? currentLine;
      const tableSeparator = mergedTableSeparator?.separator ?? sourceLines[lineIndex + 1];

      if (isTableRow(tableHeader) && isTableSeparatorRow(tableSeparator ?? '')) {
        appendLine(tableHeader);
        appendLine(tableSeparator);
        lineIndex += mergedTableSeparator ? 1 : 2;

        while (
          lineIndex < sourceLines.length &&
          !isCodeFence(sourceLines[lineIndex]) &&
          isTableRow(sourceLines[lineIndex])
        ) {
          appendLine(sourceLines[lineIndex].trimEnd());
          lineIndex += 1;
        }

        continue;
      }
    }

    appendLine(currentLine);
    lineIndex += 1;
  }

  return normalizedLines.join('\n').trim();
};

export const splitMarkdownIntoBlocks = (markdown: string): MarkdownBlock[] => {
  const sourceLines = markdown.split('\n');
  const blocks: MarkdownBlock[] = [];
  let textLines: string[] = [];
  let insideCodeFence = false;

  const appendTextBlock = () => {
    const content = textLines.join('\n').trim();
    if (content) blocks.push({ content, type: 'text' });
    textLines = [];
  };

  for (let lineIndex = 0; lineIndex < sourceLines.length;) {
    const currentLine = sourceLines[lineIndex];

    if (isCodeFence(currentLine)) {
      insideCodeFence = !insideCodeFence;
      textLines.push(currentLine);
      lineIndex += 1;
      continue;
    }

    if (
      !insideCodeFence &&
      isTableRow(currentLine) &&
      isTableSeparatorRow(sourceLines[lineIndex + 1] ?? '')
    ) {
      appendTextBlock();

      const tableLines = [currentLine, sourceLines[lineIndex + 1]];
      lineIndex += 2;

      while (
        lineIndex < sourceLines.length &&
        !isCodeFence(sourceLines[lineIndex]) &&
        isTableRow(sourceLines[lineIndex])
      ) {
        tableLines.push(sourceLines[lineIndex]);
        lineIndex += 1;
      }

      blocks.push({ content: tableLines.join('\n'), type: 'table' });
      continue;
    }

    textLines.push(currentLine);
    lineIndex += 1;
  }

  appendTextBlock();

  return blocks;
};
