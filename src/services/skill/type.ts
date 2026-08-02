import {
  InstalledSkillItem,
  SkillRecord,
  SkillRegistryResult,
  SkillSourceType,
} from '@lobechat/types';

export interface InstallSkillParams {
  description?: string;
  identifier?: string;
  instructions: string;
  name?: string;
  sourceRef?: string;
  sourceType: SkillSourceType;
  sourceUrl?: string;
}

export interface SkillService {
  getInstalledSkills: () => Promise<InstalledSkillItem[]>;
  getSkill: (identifier: string) => Promise<SkillRecord | undefined>;
  installSkill: (params: InstallSkillParams) => Promise<string>;
  installSkillFromUrl: (params: {
    authorization?: string;
    expectedIdentifier?: string;
    sourceRef?: string;
    sourceType: SkillSourceType;
    sourceUrl: string;
  }) => Promise<string>;
  resolveSkills: (identifiers: string[]) => Promise<SkillRecord[]>;
  searchRegistry: (query?: string) => Promise<SkillRegistryResult>;
  uninstallSkill: (identifier: string) => Promise<void>;
}
