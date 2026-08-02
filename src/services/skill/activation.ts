import { isSkillName } from '@lobechat/types';

const commandPattern = /^\/([\da-z]+(?:-[\da-z]+)*)\b[\t ]*/;

export interface ParsedSkillActivation {
  activatedSkillIds: string[];
  content: string;
  unknownSkillIds: string[];
}

export const parseSkillActivations = (
  content: string,
  enabledSkillIds: string[],
): ParsedSkillActivation => {
  const enabled = new Set(enabledSkillIds);
  const activatedSkillIds: string[] = [];
  const unknownSkillIds: string[] = [];
  let remaining = content.trimStart();

  while (remaining.startsWith('/')) {
    const match = remaining.match(commandPattern);
    if (!match || !isSkillName(match[1])) break;

    const identifier = match[1];
    if (!enabled.has(identifier)) {
      unknownSkillIds.push(identifier);
      break;
    }
    activatedSkillIds.push(identifier);
    remaining = remaining.slice(match[0].length).trimStart();
  }

  return {
    activatedSkillIds: [...new Set(activatedSkillIds)],
    content: activatedSkillIds.length > 0 ? remaining : content,
    unknownSkillIds: [...new Set(unknownSkillIds)],
  };
};
