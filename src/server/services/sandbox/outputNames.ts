import { posix } from 'node:path';

/**
 * Chat filenames for one call's files. A top-level file keeps its name. A
 * nested file keeps its basename unless that basename is shared by another
 * file this call returns; then `/` in its workdir-relative path becomes `_`.
 * A name that still collides gets a numeric suffix before its extension.
 * Top-level names are reserved first, so a nested file is the one renamed.
 */
const withSuffix = (filename: string, n: number) => {
  const ext = posix.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  return `${stem}_${n}${ext}`;
};

export const distinctOutputFilenames = (relativePaths: string[]): string[] => {
  const bases = relativePaths.map((name) => name.split('/').pop() || name);
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);

  const filenames = relativePaths.map((name, index) => {
    const base = bases[index];
    const shared = (counts.get(base) ?? 0) > 1;
    return name.includes('/') && shared ? name.replaceAll('/', '_') : base;
  });

  const used = new Set<string>();
  const claim = (index: number) => {
    let filename = filenames[index];
    if (used.has(filename)) {
      let n = 2;
      while (used.has(withSuffix(filename, n))) n += 1;
      filename = withSuffix(filename, n);
    }
    used.add(filename);
    filenames[index] = filename;
  };

  relativePaths.forEach((name, index) => {
    if (!name.includes('/')) claim(index);
  });
  relativePaths.forEach((name, index) => {
    if (name.includes('/')) claim(index);
  });
  return filenames;
};

/** Path under the workdir, or the absolute path without its leading slash. */
export const outputRelativeName = (workdir: string, resolved: string) => {
  const prefix = `${workdir.replace(/\/$/, '')}/`;
  if (resolved.startsWith(prefix)) return resolved.slice(prefix.length);
  return resolved.replace(/^\/+/, '');
};
