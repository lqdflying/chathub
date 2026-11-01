import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

import { isSandboxToolIdentifier } from '@/tools/sandbox/const';

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
      if (message.role !== 'tool' || !isSandboxToolIdentifier(message.plugin?.identifier)) {
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

const URL_SCHEME = /[a-z][\d+.a-z-]*:\/\//gi;

const replaceLeadingDestination = (value: string, newUrl: string) => {
  const leading = /^\s*/.exec(value)?.[0] ?? '';
  const rest = value.slice(leading.length);
  if (!rest) return undefined;
  if (rest.startsWith('<')) {
    const end = rest.indexOf('>');
    if (end < 0) return undefined;
    return `${leading}<${newUrl}>${rest.slice(end + 1)}`;
  }
  const whitespace = rest.search(/\s/);
  if (whitespace === -1) return `${leading}${newUrl}`;
  return `${leading}${newUrl}${rest.slice(whitespace)}`;
};

/** The `(` that opens this link's destination, not a `](` inside a title. */
const findDestinationParen = (source: string) => {
  let index = source.startsWith('!') ? 1 : 0;
  if (source[index] !== '[') return -1;
  index += 1;
  let depth = 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return source[index + 1] === '(' ? index + 1 : -1;
    }
    index += 1;
  }
  return -1;
};

const urlEnd = (text: string, schemeStart: number) => {
  const separator = text.indexOf('://', schemeStart);
  if (separator < 0) return schemeStart;
  let index = separator + 3;
  let paren = 0;
  let bracket = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    let stop = false;
    switch (char) {
      case '(': {
        paren += 1;
        break;
      }
      case ')': {
        if (paren === 0) stop = true;
        else paren -= 1;
        break;
      }
      case '[': {
        bracket += 1;
        break;
      }
      case ']': {
        if (bracket === 0) stop = true;
        else bracket -= 1;
        break;
      }
      default: {
        if (/[\s<>]/.test(char)) stop = true;
      }
    }
    if (stop) break;
    index += 1;
  }
  const trailing = text[index - 1];
  if (index > schemeStart && trailing && '.!,;?'.includes(trailing)) index -= 1;
  return index;
};

const destinationClose = (source: string, openParen: number) => {
  let depth = 0;
  let quote: string | undefined;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

/** Replace only the destination, leaving labels, emphasis, alt text, and titles in place. */
const rewriteDestination = (source: string, newUrl: string, kind: string) => {
  if (kind === 'definition') {
    const marker = source.indexOf(']:');
    if (marker < 0) return undefined;
    const after = source.slice(marker + 2);
    const whitespace = /^\s*/.exec(after)?.[0] ?? '';
    const replaced = replaceLeadingDestination(after.slice(whitespace.length), newUrl);
    if (replaced === undefined) return undefined;
    return `${source.slice(0, marker + 2)}${whitespace}${replaced}`;
  }
  if (source.startsWith('<') && source.endsWith('>') && !source.includes('](')) {
    return `<${newUrl}>`;
  }
  const open = findDestinationParen(source);
  if (open < 0) return undefined;
  const close = destinationClose(source, open);
  if (close < 0) return undefined;
  const replaced = replaceLeadingDestination(source.slice(open + 1, close), newUrl);
  if (replaced === undefined) return undefined;
  return `${source.slice(0, open + 1)}${replaced}${source.slice(close)}`;
};

const rewriteCompleteUrl = (raw: string, files: GeneratedFileLink[], appOrigin?: string) => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.search || parsed.hash || !appOrigin) return undefined;
  let origin: string;
  try {
    origin = new URL(appOrigin).origin;
  } catch {
    return undefined;
  }
  if (parsed.origin !== origin) return undefined;
  let pathname = parsed.pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return undefined;
  return files.find((file) => file.filename === segments[0] && raw !== file.url)?.url;
};

const replaceBareFilenames = (text: string, files: GeneratedFileLink[]) => {
  let next = text;
  const ordered = [...files].sort((left, right) => right.filename.length - left.filename.length);
  for (const file of ordered) {
    const bare = new RegExp(`(^|[^\\w./-])${escapeRegExp(file.filename)}(?![\\w.-])`, 'g');
    next = next.replaceAll(bare, `$1[${file.filename}](${file.url})`);
  }
  return next;
};

const replaceBareNames = (text: string, files: GeneratedFileLink[], appOrigin?: string) => {
  let cursor = 0;
  let next = '';
  for (const match of text.matchAll(URL_SCHEME)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    const end = urlEnd(text, start);
    if (end <= start) continue;
    const raw = text.slice(start, end);
    next += replaceBareFilenames(text.slice(cursor, start), files);
    next += rewriteCompleteUrl(raw, files, appOrigin) ?? raw;
    cursor = end;
  }
  return next + replaceBareFilenames(text.slice(cursor), files);
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

    if (
      current.type === 'link' ||
      current.type === 'image' ||
      current.type === 'definition' ||
      current.type === 'linkReference'
    ) {
      const href = current.url ?? '';
      const file = current.type === 'linkReference' ? undefined : fileForHref(href, files, appOrigin);
      if (file) {
        const source = content.slice(range.start, range.end);
        const rewritten = rewriteDestination(source, file.url, current.type);
        if (rewritten && rewritten !== source) replacements.push({ ...range, text: rewritten });
      }
      return SKIP;
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
