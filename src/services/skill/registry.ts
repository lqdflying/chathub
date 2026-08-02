import { SkillCatalogItem, isSkillName } from '@lobechat/types';

import { resolveSkillSource } from './parser';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
};

const getEntries = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  for (const key of ['skills', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
};

const getRepositorySource = (record: Record<string, unknown>) => {
  const repository = getString(record, ['repository', 'repo']);
  if (!repository) return;

  const repositoryUrl = repository.startsWith('https://')
    ? repository
    : `https://github.com/${repository}`;
  const path = getString(record, ['path', 'skillPath']);
  const ref = getString(record, ['ref', 'sourceRef', 'version']);
  const url = new URL(repositoryUrl);
  if (path) url.searchParams.set('path', path);
  if (ref) url.searchParams.set('ref', ref);
  return url.toString();
};

export const parseSkillRegistry = (payload: unknown, query = ''): SkillCatalogItem[] => {
  const search = query.trim().toLowerCase();
  const seen = new Set<string>();
  const items: SkillCatalogItem[] = [];

  for (const value of getEntries(payload)) {
    if (!isRecord(value)) continue;

    const identifier = getString(value, ['identifier', 'slug', 'name']);
    const description = getString(value, ['description', 'summary']);
    const source =
      getString(value, ['sourceUrl', 'skillUrl', 'rawUrl', 'url']) || getRepositorySource(value);

    if (!identifier || !isSkillName(identifier) || !description || !source) continue;
    if (description.length > 1024 || seen.has(identifier)) continue;
    if (search && !`${identifier} ${description}`.toLowerCase().includes(search)) continue;

    try {
      const normalized = resolveSkillSource(
        source,
        'registry',
        getString(value, ['sourceRef', 'ref', 'version']),
      );
      seen.add(identifier);
      items.push({
        description,
        identifier,
        name: identifier,
        sourceRef: normalized.sourceRef,
        sourceType: 'registry',
        sourceUrl: normalized.sourceUrl,
      });
    } catch {
      // Ignore malformed catalog entries without failing the entire registry.
    }

    if (items.length >= 100) break;
  }

  return items;
};
