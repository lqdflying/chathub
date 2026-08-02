import { RemoteSkillSourceType, SkillMetadata, isSkillName } from '@lobechat/types';
import matter from 'gray-matter';
import { sha256 } from 'js-sha256';

export const MAX_SKILL_BYTES = 128 * 1024;

export interface ParsedSkill extends SkillMetadata {
  contentHash: string;
  instructions: string;
}

export interface NormalizedSkillSource {
  sourceRef?: string;
  sourceType: RemoteSkillSourceType;
  sourceUrl: string;
}

export const assertExpectedSkillIdentifier = (actual: string, expected?: string) => {
  if (expected && actual !== expected) {
    throw new Error(`Skill identifier mismatch: expected "${expected}", received "${actual}"`);
  }
};

export const parseSkill = (raw: string): ParsedSkill => {
  if (new TextEncoder().encode(raw).byteLength > MAX_SKILL_BYTES) {
    throw new Error('Skill instructions exceed the 128 KiB limit');
  }

  const parsed = matter(raw);
  const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : '';
  const description =
    typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';

  if (!isSkillName(name)) throw new Error('Skill name must use lowercase hyphenated characters');
  if (!description || description.length > 1024) {
    throw new Error('Skill description is required and must be at most 1024 characters');
  }

  const instructions = parsed.content.trim();
  if (!instructions) throw new Error('Skill instructions cannot be empty');

  return {
    contentHash: sha256(raw),
    description,
    instructions,
    name,
  };
};

const ensureSkillFile = (path: string) => {
  const normalized = path.replaceAll(/^\/+|\/+$/g, '');
  if (!normalized) return 'SKILL.md';
  return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}/SKILL.md`;
};

const normalizeGitHubSource = (url: URL, requestedRef?: string) => {
  const [owner, repositoryWithSuffix, route, ...routeParts] = url.pathname
    .split('/')
    .filter(Boolean);
  if (!owner || !repositoryWithSuffix) throw new Error('GitHub skill URL is incomplete');

  const repository = repositoryWithSuffix.replace(/\.git$/i, '');
  let sourceRef = requestedRef || url.searchParams.get('ref') || 'main';
  let skillPath = url.searchParams.get('path') || 'SKILL.md';

  if (route === 'blob' || route === 'raw' || route === 'tree') {
    if (routeParts[0] === 'refs' && ['heads', 'tags'].includes(routeParts[1])) {
      sourceRef = routeParts.slice(0, 3).join('/');
      skillPath = routeParts.slice(3).join('/');
    } else {
      sourceRef = routeParts[0] || sourceRef;
      skillPath = routeParts.slice(1).join('/');
    }
  } else if (route) {
    skillPath = [route, ...routeParts].join('/');
  }

  skillPath = ensureSkillFile(skillPath);

  return {
    sourceRef,
    sourceUrl: `https://raw.githubusercontent.com/${owner}/${repository}/${sourceRef}/${skillPath}`,
  };
};

export const resolveSkillSource = (
  source: string,
  requestedType: RemoteSkillSourceType = 'url',
  requestedRef?: string,
): NormalizedSkillSource => {
  const url = new URL(source);
  if (url.protocol !== 'https:') throw new Error('Skill sources must use HTTPS');
  if (url.username || url.password) throw new Error('Skill source URLs cannot contain credentials');

  if (url.hostname.toLowerCase() === 'github.com') {
    const github = normalizeGitHubSource(url, requestedRef);
    return {
      sourceRef: requestedRef || github.sourceRef,
      sourceType: requestedType === 'registry' ? 'registry' : 'github',
      sourceUrl: github.sourceUrl,
    };
  }

  return {
    sourceRef: requestedRef,
    sourceType: requestedType,
    sourceUrl: url.toString(),
  };
};
