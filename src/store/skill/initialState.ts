import { InstalledSkillItem } from '@lobechat/types';

export interface SkillStoreState {
  installedSkills: InstalledSkillItem[];
  isLoading: boolean;
  selectedSkillIdsByConversation: Record<string, string[]>;
}

export const initialState: SkillStoreState = {
  installedSkills: [],
  isLoading: true,
  selectedSkillIdsByConversation: {},
};
