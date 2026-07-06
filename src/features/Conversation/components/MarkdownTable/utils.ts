/**
 * Extract the rendered table into a rows × cells string matrix.
 * Reading the DOM (instead of re-parsing markdown AST children) keeps the
 * copied values identical to what the user sees, including inline formatting.
 */
export const extractTableRows = (table: HTMLTableElement): string[][] =>
  Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th, td')).map((cell) =>
      (cell.textContent || '').replaceAll(/\s+/g, ' ').trim(),
    ),
  );

const escapeMarkdownCell = (value: string) => value.replaceAll('|', String.raw`\|`);

export const tableRowsToMarkdown = (rows: string[][]): string => {
  if (rows.length === 0) return '';

  const [header, ...body] = rows;
  const columns = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) =>
    Array.from({ length: columns }, (_, i) => escapeMarkdownCell(row[i] ?? ''));

  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`),
  ];

  return lines.join('\n');
};

const escapeCsvCell = (value: string) =>
  /[\n\r",]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const tableRowsToCsv = (rows: string[][]): string =>
  rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\n');
