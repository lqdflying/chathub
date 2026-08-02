export type RemoteSkillSourceType = 'github' | 'registry' | 'url';

export type SkillSourceType = 'file' | RemoteSkillSourceType;

export interface SkillMetadata {
  description: string;
  name: string;
}

export interface SkillCatalogItem extends SkillMetadata {
  identifier: string;
  sourceRef?: string;
  sourceType: RemoteSkillSourceType;
  sourceUrl: string;
}

export interface SkillRegistryResult {
  configured: boolean;
  items: SkillCatalogItem[];
}

export interface InstalledSkillItem extends SkillMetadata {
  contentHash: string;
  createdAt: Date;
  identifier: string;
  sourceRef?: string | null;
  sourceType: SkillSourceType;
  sourceUrl?: string | null;
  updatedAt: Date;
}

export interface SkillRecord extends InstalledSkillItem {
  instructions: string;
}

export interface SkillMessageMetadata {
  activated: string[];
}

export const MAX_ACTIVE_SKILLS = 16;

export const SKILL_NAME_PATTERN = /^[\da-z]+(?:-[\da-z]+)*$/;

export const isSkillName = (value: string) =>
  value.length > 0 && value.length <= 64 && SKILL_NAME_PATTERN.test(value);
