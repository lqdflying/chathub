/**
 * Chat filenames for one call's files. A top-level file keeps its name. A
 * nested file keeps its basename unless that basename is shared by another
 * file this call returns; then `/` in its workdir-relative path becomes `_`.
 * A flattened name that still collides gets a numeric suffix.
 */
export const distinctOutputFilenames = (relativePaths: string[]): string[] => {
  const bases = relativePaths.map((name) => name.split('/').pop() || name);
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);

  const used = new Set<string>();
  return relativePaths.map((name, index) => {
    const base = bases[index];
    const shared = (counts.get(base) ?? 0) > 1;
    let filename = name.includes('/') && shared ? name.replaceAll('/', '_') : base;
    if (used.has(filename)) {
      const stem = filename;
      let suffix = 2;
      while (used.has(`${stem}_${suffix}`)) suffix += 1;
      filename = `${stem}_${suffix}`;
    }
    used.add(filename);
    return filename;
  });
};

/** Path under the workdir, or the absolute path without its leading slash. */
export const outputRelativeName = (workdir: string, resolved: string) => {
  const prefix = `${workdir.replace(/\/$/, '')}/`;
  if (resolved.startsWith(prefix)) return resolved.slice(prefix.length);
  return resolved.replace(/^\/+/, '');
};
