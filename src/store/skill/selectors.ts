import { SkillStore } from './store';

const enabledMetadata = (identifiers: string[]) => (state: SkillStore) => {
  const enabled = new Set(identifiers);
  return state.installedSkills.filter(({ identifier }) => enabled.has(identifier));
};

const getSkillById = (identifier: string) => (state: SkillStore) =>
  state.installedSkills.find((skill) => skill.identifier === identifier);

export const skillSelectors = { enabledMetadata, getSkillById };
