import { InstalledSkillItem } from '@lobechat/types';

export interface SkillStoreState {
  installedSkills: InstalledSkillItem[];
  isLoading: boolean;
  selectedSkillIds: string[];
}

export const initialState: SkillStoreState = {
  installedSkills: [],
  isLoading: true,
  selectedSkillIds: [],
};
