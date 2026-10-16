import { isSandboxToolIdentifier } from '@/tools/sandbox/const';

export interface GeneratedFileDownload {
  fileId: string;
  filename: string;
  url: string;
}

const basename = (filename: string) => filename.replaceAll('\\', '/').split('/').pop() || filename;

let downloads = new Map<string, GeneratedFileDownload>();

export const replaceGeneratedFileDownloads = (next: GeneratedFileDownload[]) => {
  downloads = new Map(next.map((file) => [file.url, file]));
};

export const lookupGeneratedFileDownload = (url: string) => downloads.get(url);

export const readSandboxFileDownloads = (
  messages: ReadonlyArray<{
    content?: string | null;
    plugin?: { identifier?: string | null } | null;
    role?: string;
  }>,
): GeneratedFileDownload[] => {
  const byUrl = new Map<string, GeneratedFileDownload>();

  for (const message of messages) {
    if (message.role !== 'tool' || !isSandboxToolIdentifier(message.plugin?.identifier)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content ?? '');
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;

    const files = (parsed as { files?: unknown }).files;
    if (!Array.isArray(files)) continue;

    for (const entry of files) {
      if (!entry || typeof entry !== 'object') continue;
      const file = entry as { fileId?: unknown; filename?: unknown; url?: unknown };
      if (typeof file.fileId !== 'string' || !file.fileId) continue;
      if (typeof file.url !== 'string' || !file.url) continue;
      if (typeof file.filename !== 'string' || !file.filename) continue;
      byUrl.set(file.url, {
        fileId: file.fileId,
        filename: basename(file.filename),
        url: file.url,
      });
    }
  }

  return [...byUrl.values()];
};
