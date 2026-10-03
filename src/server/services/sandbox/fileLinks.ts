import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

export interface GeneratedFileLink {
  filename: string;
  url: string;
}

type Positioned = {
  children?: Positioned[];
  identifier?: string;
  label?: string;
  position?: {
    end: { offset?: number };
    start: { offset?: number };
  };
  title?: string | null;
  type: string;
  url?: string;
  value?: string;
};

const basename = (filename: string) => filename.replaceAll('\\', '/').split('/').pop() || filename;

const escapeRegExp = (value: string) =>
  [...value].map((char) => (String.raw`\^$.*+?()[]{}|`.includes(char) ? `\\${char}` : char)).join('');

const rangeOf = (node: Positioned) => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end < start) return undefined;
  return { end, start };
};

export const readGeneratedFileLinks = (content: string): GeneratedFileLink[] => {
  try {
    const parsed = JSON.parse(content) as { files?: Array<{ filename?: string; url?: string }> };
    return (parsed.files ?? []).flatMap((file) => {
      const filename = typeof file.filename === 'string' ? basename(file.filename) : '';
      if (!filename || typeof file.url !== 'string' || !file.url) return [];
      return [{ filename, url: file.url }];
    });
  } catch {
    return [];
  }
};

export const mergeGeneratedFileLinks = (
  current: GeneratedFileLink[],
  next: GeneratedFileLink[],
): GeneratedFileLink[] => {
  const byName = new Map<string, GeneratedFileLink>();
  for (const file of [...current, ...next]) {
    const filename = basename(file.filename);
    if (!filename || !file.url) continue;
    byName.set(filename, { filename, url: file.url });
  }
  return [...byName.values()];
};

export const generatedFileLinksFromMessages = (
  messages: ReadonlyArray<{
    content?: string | null;
    plugin?: { identifier?: string } | null;
    role?: string;
  }>,
): GeneratedFileLink[] =>
  mergeGeneratedFileLinks(
    [],
    messages.flatMap((message) => {
      if (message.role !== 'tool' || message.plugin?.identifier !== CodeInterpreterIdentifier) {
        return [];
      }
      return readGeneratedFileLinks(message.content ?? '');
    }),
  );

const hasOrigin = (href: string) =>
  href.startsWith('//') || /^[a-z][\d+.a-z-]*:/i.test(href);

const localFileHref = (href: string, filename: string, appOrigin?: string) => {
  const trimmed = href.trim();
  if (!trimmed || trimmed.includes('/webapi/files/')) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed, appOrigin || 'https://link.invalid');
  } catch {
    return false;
  }
  if (parsed.search || parsed.hash) return false;
  let pathname = parsed.pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 1 || segments[0] !== filename) return false;
  if (!hasOrigin(trimmed)) return true;
  if (!appOrigin) return false;
  try {
    return parsed.origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
};

const fileForHref = (href: string, files: GeneratedFileLink[], appOrigin?: string) =>
  files.find((file) => href !== file.url && localFileHref(href, file.filename, appOrigin));

const labelFrom = (node: Positioned, content: string) => {
  const children = node.children ?? [];
  const firstChild = children[0];
  const lastChild = children.at(-1);
  const first = firstChild ? rangeOf(firstChild) : undefined;
  const last = lastChild ? rangeOf(lastChild) : undefined;
  if (!first || !last) return '';
  return content.slice(first.start, last.end);
};

const titleSuffix = (title?: string | null) =>
  title ? ` "${title.replaceAll('"', String.raw`\"`)}"` : '';

const replaceBareNames = (text: string, files: GeneratedFileLink[], appOrigin?: string) => {
  let next = text;
  const ordered = [...files].sort((left, right) => right.filename.length - left.filename.length);
  for (const file of ordered) {
    if (appOrigin) {
      try {
        const origin = new URL(appOrigin).origin;
        const urlPattern = new RegExp(
          `${escapeRegExp(origin)}/${escapeRegExp(file.filename)}(?![\\w./?#-])`,
          'g',
        );
        next = next.replaceAll(urlPattern, file.url);
      } catch {
        // An unusable app origin only disables host-specific URL replacement.
      }
    }
    const bare = new RegExp(
      `(^|[^\\w./-])${escapeRegExp(file.filename)}(?![\\w.-])`,
      'g',
    );
    next = next.replaceAll(bare, `$1[${file.filename}](${file.url})`);
  }
  return next;
};

const SKIP_TEXT_PARENTS = new Set(['definition', 'image', 'link', 'linkReference']);

/** Point local filename links at the stored object. Code and other sites stay unchanged. */
export const rewriteGeneratedFileLinks = (
  content: string,
  files: GeneratedFileLink[],
  appOrigin?: string,
) => {
  if (!content || files.length === 0) return content;
  const tree = unified().use(remarkParse).parse(content);
  const replacements: Array<{ end: number; start: number; text: string }> = [];

  visit(tree, (node, _index, parent) => {
    const current = node as Positioned;
    const range = rangeOf(current);
    if (!range) return;

    if (current.type === 'link' || current.type === 'image' || current.type === 'definition') {
      const href = current.url ?? '';
      const file = fileForHref(href, files, appOrigin);
      if (!file) return;
      if (current.type === 'definition') {
        const label = current.label || current.identifier || file.filename;
        replacements.push({
          ...range,
          text: `[${label}]: ${file.url}${titleSuffix(current.title)}`,
        });
        return;
      }
      const rawLabel = labelFrom(current, content);
      const label = !rawLabel || rawLabel === href ? file.filename : rawLabel;
      const bang = current.type === 'image' ? '!' : '';
      replacements.push({
        ...range,
        text: `${bang}[${label}](${file.url}${titleSuffix(current.title)})`,
      });
      return;
    }

    if (current.type !== 'text') return;
    if (parent && SKIP_TEXT_PARENTS.has(parent.type)) return;
    const slice = content.slice(range.start, range.end);
    const replaced = replaceBareNames(slice, files, appOrigin);
    if (replaced !== slice) replacements.push({ ...range, text: replaced });
  });

  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (next, replacement) =>
        `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`,
      content,
    );
};
