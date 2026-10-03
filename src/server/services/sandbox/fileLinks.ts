import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

export interface GeneratedFileLink {
  filename: string;
  url: string;
}

const basename = (filename: string) => filename.replaceAll('\\', '/').split('/').pop() || filename;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const hrefPointsAtFilename = (href: string, filename: string) => {
  const trimmed = href.trim();
  if (!trimmed || trimmed.includes('/webapi/files/')) return false;
  let pathname = trimmed;
  try {
    pathname = decodeURIComponent(new URL(trimmed, 'https://link.invalid').pathname);
  } catch {
    pathname = trimmed;
  }
  const segments = pathname.replaceAll('\\', '/').split('/').filter(Boolean);
  return segments.length === 1 && segments[0] === filename;
};

const rewriteProse = (prose: string, files: GeneratedFileLink[]) => {
  let next = prose;
  for (const file of files) {
    next = next.replace(/https?:\/\/[^\s<>)]+/g, (raw) =>
      hrefPointsAtFilename(raw, file.filename) ? file.url : raw,
    );
    next = next.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
      if (!hrefPointsAtFilename(href, file.filename) || href === file.url) return match;
      return `[${label || file.filename}](${file.url})`;
    });
    const bare = new RegExp(
      `(^|[\\s"'（(])${escapeRegExp(file.filename)}(?=$|[\\s"'）.。,，;；:：!?])`,
      'g',
    );
    next = next.replace(bare, `$1[${file.filename}](${file.url})`);
  }
  return next;
};

/** Point filename links at the stored object. Code spans stay untouched. */
export const rewriteGeneratedFileLinks = (content: string, files: GeneratedFileLink[]) => {
  if (!content || files.length === 0) return content;
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts.map((part, index) => (index % 2 === 1 ? part : rewriteProse(part, files))).join('');
};
